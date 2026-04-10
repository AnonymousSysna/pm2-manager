// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authRouter = require("../routes/auth");
const { verifyCsrf } = require("../middleware/csrf");
const { resetAuthSessionStore } = require("../utils/authSessionStore");
const { verifyAccessToken } = require("../utils/accessToken");
const { disconnectUserSockets, getUserSocketRoom } = require("../utils/socketSessions");

const {
  resolvePreferredEnvPath,
  updateEnvPasswordHash
} = authRouter;

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readCookieJar(setCookies = []) {
  return setCookies.reduce((acc, value) => {
    const [pair] = String(value || "").split(";", 1);
    const [name, ...rest] = pair.split("=");
    acc[name] = rest.join("=");
    return acc;
  }, {});
}

function findSetCookie(setCookies = [], name) {
  return setCookies.find((value) => String(value || "").startsWith(`${name}=`)) || "";
}

function toCookieHeader(cookieJar = {}) {
  return Object.entries(cookieJar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function loginAndCaptureSession(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  return {
    response,
    cookieJar: readCookieJar(response.headers.getSetCookie())
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use(verifyCsrf);
  app.use("/api/v1/auth", authRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

test("logout clears auth cookies even when the access token is expired", async () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.COOKIE_SECURE = "false";
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  resetAuthSessionStore();

  const expiredToken = jwt.sign(
    {
      username: "admin",
      tokenType: "access",
      exp: Math.floor(Date.now() / 1000) - 60
    },
    process.env.JWT_SECRET
  );

  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        cookie: `pm2_session=${expiredToken}; pm2_refresh=refresh-token; pm2_csrf=test-csrf`,
        "x-csrf-token": "test-csrf"
      }
    });
    const payload = await response.json();
    const clearCookies = response.headers.getSetCookie();

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data?.loggedOut, true);
    assert.equal(clearCookies.some((value) => value.startsWith("pm2_session=")), true);
    assert.equal(clearCookies.some((value) => value.startsWith("pm2_refresh=")), true);
    assert.equal(clearCookies.some((value) => value.startsWith("pm2_csrf=")), true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("logout revokes an existing refresh token", async () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH,
    PM2_USER: process.env.PM2_USER,
    PM2_PASS: process.env.PM2_PASS,
    PM2_PASS_HASH: process.env.PM2_PASS_HASH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.COOKIE_SECURE = "false";
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  process.env.PM2_USER = "admin";
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = bcrypt.hashSync("secret", 10);
  resetAuthSessionStore();

  const { server, baseUrl } = await startServer();
  try {
    const login = await loginAndCaptureSession(baseUrl, "admin", "secret");
    assert.equal(login.response.status, 200);
    assert.ok(login.cookieJar.pm2_refresh);
    assert.ok(login.cookieJar.pm2_csrf);

    const logoutResponse = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: {
        cookie: toCookieHeader(login.cookieJar),
        "x-csrf-token": login.cookieJar.pm2_csrf
      }
    });
    assert.equal(logoutResponse.status, 200);

    const refreshResponse = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: toCookieHeader(login.cookieJar)
      }
    });
    const refreshPayload = await refreshResponse.json();

    assert.equal(refreshResponse.status, 401);
    assert.equal(refreshPayload.error, "Invalid refresh token");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("login keeps SameSite=Lax cookies for same-origin requests", async () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH,
    PM2_USER: process.env.PM2_USER,
    PM2_PASS: process.env.PM2_PASS,
    PM2_PASS_HASH: process.env.PM2_PASS_HASH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.COOKIE_SECURE = "false";
  delete process.env.COOKIE_SAME_SITE;
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  process.env.PM2_USER = "admin";
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = bcrypt.hashSync("secret", 10);
  resetAuthSessionStore();

  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ username: "admin", password: "secret" })
    });
    const setCookies = response.headers.getSetCookie();

    assert.equal(response.status, 200);
    assert.match(findSetCookie(setCookies, "pm2_session"), /SameSite=Lax/i);
    assert.doesNotMatch(findSetCookie(setCookies, "pm2_session"), /SameSite=None/i);
    assert.match(findSetCookie(setCookies, "pm2_csrf"), /SameSite=Lax/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("login issues SameSite=None cookies for secure cross-origin requests", async () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH,
    PM2_USER: process.env.PM2_USER,
    PM2_PASS: process.env.PM2_PASS,
    PM2_PASS_HASH: process.env.PM2_PASS_HASH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  delete process.env.COOKIE_SECURE;
  delete process.env.COOKIE_SAME_SITE;
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  process.env.PM2_USER = "admin";
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = bcrypt.hashSync("secret", 10);
  resetAuthSessionStore();

  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "api.example.com"
      },
      body: JSON.stringify({ username: "admin", password: "secret" })
    });
    const setCookies = response.headers.getSetCookie();

    assert.equal(response.status, 200);
    assert.match(findSetCookie(setCookies, "pm2_session"), /SameSite=None/i);
    assert.match(findSetCookie(setCookies, "pm2_session"), /Secure/i);
    assert.match(findSetCookie(setCookies, "pm2_refresh"), /SameSite=None/i);
    assert.match(findSetCookie(setCookies, "pm2_csrf"), /SameSite=None/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("change-password revokes old refresh tokens and reissues the current session", async () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH,
    PM2_USER: process.env.PM2_USER,
    PM2_PASS: process.env.PM2_PASS,
    PM2_PASS_HASH: process.env.PM2_PASS_HASH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.COOKIE_SECURE = "false";
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  process.env.PM2_USER = "admin";
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = bcrypt.hashSync("secret", 10);
  resetAuthSessionStore();

  const { server, baseUrl } = await startServer();
  try {
    const login = await loginAndCaptureSession(baseUrl, "admin", "secret");
    assert.equal(login.response.status, 200);

    const changePasswordResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: toCookieHeader(login.cookieJar),
        "x-csrf-token": login.cookieJar.pm2_csrf
      },
      body: JSON.stringify({
        currentPassword: "secret",
        newPassword: "Better-pass1"
      })
    });
    const changePasswordPayload = await changePasswordResponse.json();
    const rotatedCookieJar = readCookieJar(changePasswordResponse.headers.getSetCookie());

    assert.equal(changePasswordResponse.status, 200);
    assert.equal(changePasswordPayload.success, true);
    assert.ok(rotatedCookieJar.pm2_session);
    assert.ok(rotatedCookieJar.pm2_refresh);
    assert.ok(rotatedCookieJar.pm2_csrf);

    const staleRefreshResponse = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        cookie: toCookieHeader(login.cookieJar)
      }
    });
    const staleRefreshPayload = await staleRefreshResponse.json();
    assert.equal(staleRefreshResponse.status, 401);
    assert.equal(staleRefreshPayload.error, "Invalid refresh token");

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: "GET",
      headers: {
        cookie: toCookieHeader(rotatedCookieJar)
      }
    });
    const mePayload = await meResponse.json();

    assert.equal(meResponse.status, 200);
    assert.equal(mePayload.data?.authenticated, true);
    assert.equal(mePayload.data?.user?.username, "admin");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("change-password rejects weak or whitespace-padded passwords", async () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH,
    PM2_USER: process.env.PM2_USER,
    PM2_PASS: process.env.PM2_PASS,
    PM2_PASS_HASH: process.env.PM2_PASS_HASH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.COOKIE_SECURE = "false";
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  process.env.PM2_USER = "admin";
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = bcrypt.hashSync("secret", 10);
  resetAuthSessionStore();

  const { server, baseUrl } = await startServer();
  try {
    const login = await loginAndCaptureSession(baseUrl, "admin", "secret");
    assert.equal(login.response.status, 200);

    const weakResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: toCookieHeader(login.cookieJar),
        "x-csrf-token": login.cookieJar.pm2_csrf
      },
      body: JSON.stringify({
        currentPassword: "secret",
        newPassword: "change-this-secret"
      })
    });
    const weakPayload = await weakResponse.json();
    assert.equal(weakResponse.status, 400);
    assert.equal(weakPayload.error, "New password is too weak");

    const paddedResponse = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: toCookieHeader(login.cookieJar),
        "x-csrf-token": login.cookieJar.pm2_csrf
      },
      body: JSON.stringify({
        currentPassword: "secret",
        newPassword: " Better-pass1 "
      })
    });
    const paddedPayload = await paddedResponse.json();
    assert.equal(paddedResponse.status, 400);
    assert.equal(paddedPayload.error, "New password cannot start or end with whitespace");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("shared access token verifier rejects revoked tokens", () => {
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    AUTH_SESSION_STORE_PATH: process.env.AUTH_SESSION_STORE_PATH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.AUTH_SESSION_STORE_PATH = path.join(tempDir, "auth-sessions.json");
  resetAuthSessionStore();

  try {
    const firstToken = jwt.sign(
      { username: "admin", tokenType: "access", tokenVersion: 0 },
      process.env.JWT_SECRET
    );
    verifyAccessToken(firstToken, process.env.JWT_SECRET);

    const { bumpTokenVersion } = require("../utils/authSessionStore");
    bumpTokenVersion("admin");

    assert.throws(
      () => verifyAccessToken(firstToken, process.env.JWT_SECRET),
      /Revoked token/
    );
  } finally {
    resetAuthSessionStore();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("disconnectUserSockets disconnects all sockets in the user room", async () => {
  const disconnected = [];
  const sockets = [
    { disconnect(force) { disconnected.push(force); } },
    { disconnect(force) { disconnected.push(force); } }
  ];
  let requestedRoom = null;
  const io = {
    in(room) {
      requestedRoom = room;
      return {
        async fetchSockets() {
          return sockets;
        }
      };
    }
  };

  const count = await disconnectUserSockets(io, "admin");

  assert.equal(count, 2);
  assert.equal(requestedRoom, getUserSocketRoom("admin"));
  assert.deepEqual(disconnected, [true, true]);
});

test("password hash updates target the highest-precedence env file", () => {
  const tempDir = makeTempDir("pm2-manager-env-");
  const serverEnvPath = path.join(tempDir, "server", ".env");
  const rootEnvPath = path.join(tempDir, ".env");
  fs.mkdirSync(path.dirname(serverEnvPath), { recursive: true });
  fs.writeFileSync(serverEnvPath, "PM2_PASS_HASH=server-old\n", "utf8");
  fs.writeFileSync(rootEnvPath, "PM2_PASS=old-password\nPM2_PASS_HASH=root-old\nJWT_SECRET=test\n", "utf8");

  try {
    const targetPath = resolvePreferredEnvPath([serverEnvPath, rootEnvPath]);
    updateEnvPasswordHash("new-hash", targetPath);

    assert.equal(targetPath, path.resolve(rootEnvPath));
    assert.equal(fs.readFileSync(serverEnvPath, "utf8"), "PM2_PASS_HASH=server-old\n");
    assert.equal(
      fs.readFileSync(rootEnvPath, "utf8"),
      "PM2_PASS_HASH=new-hash\nJWT_SECRET=test\n"
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

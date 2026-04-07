// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const authRouter = require("../routes/auth");
const { verifyCsrf } = require("../middleware/csrf");

const {
  resolvePreferredEnvPath,
  updateEnvPasswordHash
} = authRouter;

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH
  };
  const tempDir = makeTempDir("pm2-manager-auth-");
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.COOKIE_SECURE = "false";
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");

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

// @ts-nocheck
const fs = require("fs");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { verifyToken, getTokenFromRequest } = require("../middleware/auth");
const { isIpAllowed, getRequestIp } = require("../utils/ipAccess");
const { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const {
  setCsrfCookie,
  CSRF_COOKIE_NAME,
  shouldUseSecureCookies,
  getCookieSameSite
} = require("../middleware/csrf");
const { logger } = require("../utils/logger");
const { getAttempt, setAttempt, clearAttempt } = require("../utils/loginAttemptsStore");
const { getTokenVersion, bumpTokenVersion } = require("../utils/authSessionStore");
const { parseCookieHeader } = require("../utils/cookies");
const { appendAuditEntry } = require("../utils/auditTrail");
const { validateNewPassword } = require("../utils/passwordPolicy");
const { disconnectUserSockets } = require("../utils/socketSessions");

const router = express.Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL_SEC = Number.isFinite(Number(process.env.ACCESS_TOKEN_TTL_SEC))
  ? Math.max(60, Math.floor(Number(process.env.ACCESS_TOKEN_TTL_SEC)))
  : 15 * 60;
const REFRESH_TOKEN_TTL_SEC = Number.isFinite(Number(process.env.REFRESH_TOKEN_TTL_SEC))
  ? Math.max(5 * 60, Math.floor(Number(process.env.REFRESH_TOKEN_TTL_SEC)))
  : 7 * 24 * 60 * 60;

let cachedHash = String(process.env.PM2_PASS_HASH || "").trim() || null;
const AUTH_ENV_FILE_PATHS = [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env")
];

async function writeAuthAudit(action, ip, username, success, details = null) {
  try {
    await appendAuditEntry({
      action,
      ip: String(ip || "unknown"),
      actor: String(username || "unknown"),
      success: Boolean(success),
      details
    });
  } catch (_error) {
    // Best-effort audit append.
  }
}

function clearAuthCookies(res, req) {
  const secureCookie = shouldUseSecureCookies(req);
  const sameSite = getCookieSameSite(req);
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: secureCookie,
    sameSite,
    path: "/"
  });
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: secureCookie,
    sameSite,
    path: "/"
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: secureCookie,
    sameSite,
    path: "/"
  });
}

function issueAuthCookies(res, req, username, jwtSecret) {
  const tokenVersion = getTokenVersion(username);
  const accessToken = jwt.sign(
    { username, tokenType: "access", tokenVersion },
    jwtSecret,
    { expiresIn: ACCESS_TOKEN_TTL_SEC }
  );
  const refreshToken = jwt.sign(
    { username, tokenType: "refresh", tokenVersion },
    jwtSecret,
    { expiresIn: REFRESH_TOKEN_TTL_SEC }
  );

  const secureCookie = shouldUseSecureCookies(req);
  const sameSite = getCookieSameSite(req);
  res.cookie(AUTH_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: secureCookie,
    sameSite,
    maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
    path: "/"
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: secureCookie,
    sameSite,
    maxAge: REFRESH_TOKEN_TTL_SEC * 1000,
    path: "/"
  });
  setCsrfCookie(res, req);
}

function getUserConfig(username) {
  const adminUser = String(process.env.PM2_USER || "").trim();
  if (!adminUser || username !== adminUser) return null;

  const envHash = String(process.env.PM2_PASS_HASH || "").trim() || null;
  if (envHash && envHash !== cachedHash) {
    cachedHash = envHash;
  }

  // Support plain PM2_PASS as a fallback (auto-hashed in memory only)
  if (!cachedHash) {
    const plain = String(process.env.PM2_PASS || "").trim();
    if (!plain) return null;
    cachedHash = bcrypt.hashSync(plain, 10);
  }

  return { hash: cachedHash };
}

function resolvePreferredEnvPath(envPaths = AUTH_ENV_FILE_PATHS) {
  const candidates = Array.isArray(envPaths) && envPaths.length > 0
    ? envPaths.map((candidate) => path.resolve(candidate))
    : AUTH_ENV_FILE_PATHS;

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    if (fs.existsSync(candidates[i])) {
      return candidates[i];
    }
  }

  return candidates[candidates.length - 1];
}

function updateEnvPasswordHash(newPasswordHash, envPath = resolvePreferredEnvPath()) {
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `PM2_PASS_HASH=${newPasswordHash}\n`, "utf8");
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const filtered = lines.filter((line) => !/^PM2_PASS=/.test(line));
  let updated = false;
  for (let i = 0; i < filtered.length; i += 1) {
    if (/^PM2_PASS_HASH=/.test(filtered[i])) {
      filtered[i] = `PM2_PASS_HASH=${newPasswordHash}`;
      updated = true;
      break;
    }
  }
  if (!updated) {
    filtered.push(`PM2_PASS_HASH=${newPasswordHash}`);
  }
  fs.writeFileSync(envPath, `${filtered.filter(Boolean).join("\n")}\n`, "utf8");
}

function getLogoutUser(req) {
  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  if (!jwtSecret) {
    return null;
  }

  const cookies = parseCookieHeader(req.headers.cookie || "");
  const candidateTokens = [
    getTokenFromRequest(req),
    String(cookies[REFRESH_COOKIE_NAME] || "").trim()
  ].filter(Boolean);

  for (const token of candidateTokens) {
    try {
      const decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true });
      if (
        decoded?.username &&
        (!decoded?.tokenType || decoded.tokenType === "access" || decoded.tokenType === "refresh")
      ) {
        return decoded;
      }
    } catch (_error) {
      // Ignore invalid token candidates.
    }
  }

  return null;
}

router.post("/login", asyncHandler(async (req, res) => {
  const ip = getRequestIp(req) || "unknown";
  if (!isIpAllowed(ip)) {
    logger.warn("auth_login_failed", { reason: "ip_blocked", ip });
    await writeAuthAudit("auth.login", ip, req.body?.username || "unknown", false, { reason: "ip_blocked" });
    return res.status(403).json({
      success: false,
      data: null,
      error: "Access denied for this IP"
    });
  }

  const now = Date.now();
  const state = getAttempt(ip);
  if (state?.blockedUntil && state.blockedUntil > now) {
    logger.warn("auth_login_failed", { reason: "rate_limited", ip, blockedUntil: state.blockedUntil });
    await writeAuthAudit("auth.login", ip, req.body?.username || "unknown", false, { reason: "rate_limited" });
    return res.status(429).json({
      success: false,
      data: null,
      error: "Too many login attempts. Try again later."
    });
  }

  const { username, password } = req.body || {};
  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  const userConfig = getUserConfig(username);

  if (!jwtSecret) {
    logger.error("auth_login_server_misconfigured", { ip, username });
    await writeAuthAudit("auth.login", ip, username || "unknown", false, { reason: "server_misconfigured" });
    return res.status(503).json({
      success: false,
      data: null,
      error: "Server auth misconfigured"
    });
  }

  if (!userConfig?.hash) {
    const count = (state?.count || 0) + 1;
    setAttempt(ip, {
      count,
      blockedUntil: count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0
    });
    logger.warn("auth_login_failed", { reason: "missing_user_hash", username, ip });
    await writeAuthAudit("auth.login", ip, username || "unknown", false, { reason: "missing_user_hash" });
    clearAuthCookies(res, req);
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  const incomingMatches = await bcrypt.compare(password || "", userConfig.hash);
  if (!incomingMatches) {
    const count = (state?.count || 0) + 1;
    setAttempt(ip, {
      count,
      blockedUntil: count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0
    });
    logger.warn("auth_login_failed", { reason: "bad_password", username, ip });
    await writeAuthAudit("auth.login", ip, username || "unknown", false, { reason: "bad_password" });
    clearAuthCookies(res, req);
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  clearAttempt(ip);

  issueAuthCookies(res, req, username, jwtSecret);
  logger.info("auth_login_success", { username, ip });
  await writeAuthAudit("auth.login", ip, username || "unknown", true, { reason: "success" });

  return res.json({ success: true, data: { authenticated: true }, error: null });
}));

router.post("/refresh", asyncHandler(async (req, res) => {
  const ip = getRequestIp(req) || "unknown";
  if (!isIpAllowed(ip)) {
    logger.warn("auth_refresh_failed", { reason: "ip_blocked", ip });
    clearAuthCookies(res, req);
    return res.status(403).json({
      success: false,
      data: null,
      error: "Access denied for this IP"
    });
  }

  const jwtSecret = String(process.env.JWT_SECRET || "").trim();
  if (!jwtSecret) {
    logger.error("auth_refresh_server_misconfigured", { ip });
    clearAuthCookies(res, req);
    return res.status(503).json({
      success: false,
      data: null,
      error: "Server auth misconfigured"
    });
  }

  const cookies = parseCookieHeader(req.headers.cookie || "");
  const refreshToken = String(cookies[REFRESH_COOKIE_NAME] || "").trim();
  if (!refreshToken) {
    clearAuthCookies(res, req);
    return res.status(401).json({ success: false, data: null, error: "Unauthorized" });
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, jwtSecret);
  } catch (_error) {
    clearAuthCookies(res, req);
    return res.status(401).json({ success: false, data: null, error: "Invalid refresh token" });
  }

  if (decoded?.tokenType !== "refresh" || !decoded?.username) {
    clearAuthCookies(res, req);
    return res.status(401).json({ success: false, data: null, error: "Invalid refresh token" });
  }

  const currentTokenVersion = getTokenVersion(decoded.username);
  const tokenVersion = Number.isInteger(decoded?.tokenVersion)
    ? decoded.tokenVersion
    : 0;
  if (tokenVersion !== currentTokenVersion) {
    clearAuthCookies(res, req);
    return res.status(401).json({ success: false, data: null, error: "Invalid refresh token" });
  }

  const userConfig = getUserConfig(decoded.username);
  if (!userConfig?.hash) {
    clearAuthCookies(res, req);
    return res.status(401).json({ success: false, data: null, error: "Invalid refresh token" });
  }

  issueAuthCookies(res, req, decoded.username, jwtSecret);
  logger.info("auth_refresh_success", { username: decoded.username, ip });
  return res.json({ success: true, data: { refreshed: true }, error: null });
}));

router.post("/change-password", verifyToken, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    logger.warn("auth_password_change_failed", { reason: "missing_fields", username: req.user?.username || null, ip: getRequestIp(req) });
    return res.status(400).json({
      success: false,
      data: null,
      error: "currentPassword and newPassword are required"
    });
  }

  const currentMatches = await bcrypt.compare(currentPassword, getUserConfig(req.user?.username)?.hash || "");
  if (!currentMatches) {
    logger.warn("auth_password_change_failed", { reason: "bad_current_password", username: req.user?.username || null, ip: getRequestIp(req) });
    return res.status(400).json({
      success: false,
      data: null,
      error: "Current password is incorrect"
    });
  }

  const passwordError = validateNewPassword(newPassword);
  if (passwordError) {
    logger.warn("auth_password_change_failed", {
      reason: "weak_new_password",
      username: req.user?.username || null,
      ip: getRequestIp(req)
    });
    return res.status(400).json({
      success: false,
      data: null,
      error: passwordError
    });
  }

  cachedHash = bcrypt.hashSync(newPassword, 10);
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = cachedHash;
  bumpTokenVersion(req.user?.username);
  await disconnectUserSockets(req.app?.get("io"), req.user?.username);

  updateEnvPasswordHash(cachedHash);
  issueAuthCookies(res, req, req.user?.username, String(process.env.JWT_SECRET || "").trim());
  logger.info("auth_password_changed", { username: req.user?.username || null, ip: getRequestIp(req) });
  return res.json({ success: true, data: { updated: true }, error: null });
}));

router.get("/me", verifyToken, asyncHandler(async (req, res) => {
  setCsrfCookie(res, req);
  return res.json({
    success: true,
    data: {
      authenticated: true,
      user: {
        username: req.user?.username || null
      }
    },
    error: null
  });
}));

router.post("/logout", asyncHandler(async (req, res) => {
  const ip = getRequestIp(req) || "unknown";
  const user = getLogoutUser(req);
  if (user?.username) {
    bumpTokenVersion(user.username);
    await disconnectUserSockets(req.app?.get("io"), user.username);
  }
  clearAuthCookies(res, req);
  logger.info("auth_logout", { ip, username: user?.username || null });
  await writeAuthAudit("auth.logout", ip, user?.username || "unknown", true, { reason: "success" });

  return res.json({ success: true, data: { loggedOut: true }, error: null });
}));

module.exports = router;
module.exports.AUTH_ENV_FILE_PATHS = AUTH_ENV_FILE_PATHS;
module.exports.resolvePreferredEnvPath = resolvePreferredEnvPath;
module.exports.updateEnvPasswordHash = updateEnvPasswordHash;


const fs = require("fs");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middleware/auth");
const { isIpAllowed, getRequestIp } = require("../utils/ipAccess");
const { AUTH_COOKIE_NAME } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const { setCsrfCookie, CSRF_COOKIE_NAME } = require("../middleware/csrf");
const { logger } = require("../utils/logger");
const { getAttempt, setAttempt, clearAttempt } = require("../utils/loginAttemptsStore");

const router = express.Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

let cachedHash = String(process.env.PM2_PASS_HASH || "").trim() || null;

function getUserConfig(username) {
  const adminUser = String(process.env.PM2_USER || "").trim();
  if (!adminUser || username !== adminUser) return null;

  // Support plain PM2_PASS as a fallback (auto-hashed in memory only)
  if (!cachedHash) {
    const plain = String(process.env.PM2_PASS || "").trim();
    if (!plain) return null;
    cachedHash = bcrypt.hashSync(plain, 10);
  }

  return { hash: cachedHash };
}

function updateEnvPasswordHash(newPasswordHash) {
  const envPath = path.resolve(__dirname, "../.env");
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

router.post("/login", asyncHandler(async (req, res) => {
  const ip = getRequestIp(req) || "unknown";
  if (!isIpAllowed(ip)) {
    logger.warn("auth_login_failed", { reason: "ip_blocked", ip });
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
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  clearAttempt(ip);

  const token = jwt.sign(
    { username },
    jwtSecret,
    { expiresIn: "24h" }
  );

  const secureCookie = String(process.env.NODE_ENV || "").trim() === "production";
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  });
  setCsrfCookie(res);
  logger.info("auth_login_success", { username, ip });

  return res.json({ success: true, data: { authenticated: true }, error: null });
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

  cachedHash = bcrypt.hashSync(newPassword, 10);
  delete process.env.PM2_PASS;
  process.env.PM2_PASS_HASH = cachedHash;

  updateEnvPasswordHash(cachedHash);
  logger.info("auth_password_changed", { username: req.user?.username || null, ip: getRequestIp(req) });
  return res.json({ success: true, data: { updated: true }, error: null });
}));

router.get("/me", verifyToken, asyncHandler(async (req, res) => {
  setCsrfCookie(res);
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

router.post("/logout", verifyToken, asyncHandler(async (req, res) => {
  const secureCookie = String(process.env.NODE_ENV || "").trim() === "production";
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/"
  });
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: secureCookie,
    sameSite: "lax",
    path: "/"
  });
  logger.info("auth_logout", { ip: getRequestIp(req), username: req.user?.username || null });

  return res.json({ success: true, data: { loggedOut: true }, error: null });
}));

module.exports = router;

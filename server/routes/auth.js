const fs = require("fs");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middleware/auth");
const { isIpAllowed, getRequestIp } = require("../utils/ipAccess");

const router = express.Router();

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const attemptsByIp = new Map();

let cachedPassword = process.env.PM2_PASS || "";
let cachedHash = null;

function getCurrentPasswordHash() {
  if (!cachedHash) {
    cachedHash = bcrypt.hashSync(cachedPassword, 10);
  }
  return cachedHash;
}

function updateEnvPassword(newPassword) {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `PM2_PASS=${newPassword}\n`, "utf8");
    return;
  }

  const envContent = fs.readFileSync(envPath, "utf8");
  if (envContent.includes("PM2_PASS=")) {
    const updated = envContent.replace(/PM2_PASS=.*/g, `PM2_PASS=${newPassword}`);
    fs.writeFileSync(envPath, updated, "utf8");
    return;
  }

  fs.writeFileSync(envPath, `${envContent.trim()}\nPM2_PASS=${newPassword}\n`, "utf8");
}

router.post("/login", async (req, res) => {
  const ip = getRequestIp(req) || "unknown";
  if (!isIpAllowed(ip)) {
    return res.status(403).json({
      success: false,
      data: null,
      error: "Access denied for this IP"
    });
  }

  const now = Date.now();
  const state = attemptsByIp.get(ip);
  if (state?.blockedUntil && state.blockedUntil > now) {
    return res.status(429).json({
      success: false,
      data: null,
      error: "Too many login attempts. Try again later."
    });
  }

  const { username, password } = req.body || {};

  const expectedUser = process.env.PM2_USER || "";
  const expectedPassword = cachedPassword;
  const jwtSecret = String(process.env.JWT_SECRET || "").trim();

  if (!expectedUser || !expectedPassword || !jwtSecret) {
    return res.status(503).json({
      success: false,
      data: null,
      error: "Server auth misconfigured"
    });
  }

  if (username !== expectedUser) {
    const count = (state?.count || 0) + 1;
    attemptsByIp.set(ip, {
      count,
      blockedUntil: count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0
    });
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  const incomingMatches = await bcrypt.compare(password || "", getCurrentPasswordHash());
  const fallbackMatch = password === expectedPassword;

  if (!incomingMatches && !fallbackMatch) {
    const count = (state?.count || 0) + 1;
    attemptsByIp.set(ip, {
      count,
      blockedUntil: count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0
    });
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  attemptsByIp.delete(ip);

  const token = jwt.sign(
    { username, role: "admin" },
    jwtSecret,
    { expiresIn: "24h" }
  );

  return res.json({ success: true, data: { token }, error: null });
});

router.post("/change-password", verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      data: null,
      error: "currentPassword and newPassword are required"
    });
  }

  const currentMatches = await bcrypt.compare(currentPassword, getCurrentPasswordHash());
  const currentFallback = currentPassword === cachedPassword;

  if (!currentMatches && !currentFallback) {
    return res.status(400).json({
      success: false,
      data: null,
      error: "Current password is incorrect"
    });
  }

  cachedPassword = newPassword;
  cachedHash = bcrypt.hashSync(newPassword, 10);
  process.env.PM2_PASS = newPassword;

  try {
    updateEnvPassword(newPassword);
    return res.json({ success: true, data: { updated: true }, error: null });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, data: null, error: error.message });
  }
});

module.exports = router;

const fs = require("fs");
const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

let cachedPassword = process.env.PM2_PASS || "changeme";
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
  const { username, password } = req.body || {};

  const expectedUser = process.env.PM2_USER || "admin";
  const expectedPassword = cachedPassword;

  if (username !== expectedUser) {
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  const incomingMatches = await bcrypt.compare(password || "", getCurrentPasswordHash());
  const fallbackMatch = password === expectedPassword;

  if (!incomingMatches && !fallbackMatch) {
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { username, role: "admin" },
    process.env.JWT_SECRET || "dev-secret-key",
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

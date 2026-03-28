// @ts-nocheck
const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const { readLimiter, criticalWriteLimiter } = require("../middleware/rateLimit");
const {
  getCaddyStatus,
  installCaddy,
  addReverseProxy,
  restartCaddyService
} = require("../controllers/caddyController");

const router = express.Router();

router.use(verifyToken);

router.get("/status", readLimiter, asyncHandler(async (_req, res) => {
  const result = await getCaddyStatus();
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/install", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await installCaddy();
  const status = result.success
    ? 200
    : /no supported|not available|not found/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/proxies", criticalWriteLimiter, asyncHandler(async (req, res) => {
  const result = await addReverseProxy(req.body || {});
  const status = result.success
    ? 200
    : /required|invalid|not installed/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/restart", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await restartCaddyService();
  const status = result.success
    ? 200
    : /not installed/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

module.exports = router;


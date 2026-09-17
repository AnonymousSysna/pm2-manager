const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const { readLimiter, criticalWriteLimiter } = require("../middleware/rateLimit");
const {
  getJcodeStatus,
  installJcode,
  startJcodeGateway,
  stopJcodeGateway,
  runJcodeAction
} = require("../controllers/jcodeController");

const router = express.Router();

router.use(verifyToken);

router.get("/status", readLimiter, asyncHandler(async (_req, res) => {
  const result = await getJcodeStatus();
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/install", criticalWriteLimiter, asyncHandler(async (req, res) => {
  const result = await installJcode(req.body || {});
  const status = result.success
    ? 200
    : /confirmation|required|not found|not supported|failed/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/gateway/start", criticalWriteLimiter, asyncHandler(async (req, res) => {
  const result = await startJcodeGateway(req.body || {});
  const status = result.success
    ? 200
    : /install|required|port/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/gateway/stop", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await stopJcodeGateway();
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/actions", criticalWriteLimiter, asyncHandler(async (req, res) => {
  const result = await runJcodeAction(req.body || {});
  const status = result.success
    ? 200
    : /install|required|unsupported|failed/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

module.exports = router;

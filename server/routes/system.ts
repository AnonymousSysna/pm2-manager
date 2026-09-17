const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { readLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { getEnvironmentReport } = require("../utils/envGuard");
const { getPM2QueueState } = require("../utils/pm2Client");

const router = express.Router();

router.use(verifyToken);

router.get("/readiness", readLimiter, asyncHandler(async (_req, res) => {
  const report = getEnvironmentReport();
  res.status(report.ok ? 200 : 503).json({
    success: report.ok,
    data: {
      ...report,
      pm2Queue: getPM2QueueState(),
      checkedAt: Date.now()
    },
    error: report.ok ? null : "Production readiness checks failed"
  });
}));

module.exports = router;

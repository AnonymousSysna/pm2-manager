const os = require("os");
const express = require("express");
const pm2 = require("pm2");
const pm2Package = require("pm2/package.json");
const { verifyToken } = require("../middleware/auth");
const { withPM2 } = require("../utils/pm2Client");
const { readLimiter, criticalWriteLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { trackPm2Operation } = require("../middleware/metrics");

const router = express.Router();

router.use(verifyToken);
router.use(readLimiter);

router.post("/save", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.dump((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ saved: true });
        });
      })
  );

  trackPm2Operation("save", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/resurrect", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.resurrect((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ resurrected: true });
        });
      })
  );

  trackPm2Operation("resurrect", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/kill", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.killDaemon((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ killed: true });
        });
      })
  );

  trackPm2Operation("kill", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/info", asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.list((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            pm2Version: pm2Package.version || "unknown",
            nodeVersion: process.version,
            pm2Home: process.env.PM2_HOME || os.homedir()
          });
        });
      })
  );

  trackPm2Operation("info", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

module.exports = router;

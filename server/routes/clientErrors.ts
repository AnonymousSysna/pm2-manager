const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const { logger } = require("../utils/logger");
const {
  createClientErrorStore,
  publicReport,
  sanitizeClientErrorReport
} = require("../utils/clientErrorReport");

const router = express.Router();
const store = createClientErrorStore();

// Unauthenticated by design: a crash on the login screen must still be reportable.
// The endpoint is write-only from the client's point of view, stores nothing on disk,
// and is capped per IP, so the exposure is bounded.
const reportLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many client error reports. Please retry shortly."
});

router.post("/", reportLimiter, (req, res) => {
  const result = sanitizeClientErrorReport(req.body);
  if (!result.ok) {
    res.status(400).json({ success: false, data: null, error: result.error });
    return;
  }

  const report = result.value;
  const { entry, fingerprint, duplicate } = store.record(report, { ip: req.ip });

  const meta = {
    fingerprint,
    occurrences: entry.count,
    kind: report.kind,
    source: report.source,
    route: report.route,
    release: report.release,
    message: report.message,
    stack: report.stack,
    componentStack: report.componentStack,
    url: report.url,
    ip: req.ip
  };

  // Log the first sighting loudly and repeats quietly so a render loop cannot flood the log.
  if (duplicate) {
    logger.debug("client_error_repeated", meta);
  } else {
    logger.warn("client_error_reported", meta);
  }

  res.status(202).json({ success: true, data: { fingerprint, occurrences: entry.count }, error: null });
});

router.get("/", verifyToken, (_req, res) => {
  res.json({
    success: true,
    data: { total: store.size(), reports: store.list().slice(0, 50).map(publicReport) },
    error: null
  });
});

router.delete("/", verifyToken, (_req, res) => {
  store.clear();
  res.json({ success: true, data: { total: 0, reports: [] }, error: null });
});

module.exports = router;
module.exports.__store = store;

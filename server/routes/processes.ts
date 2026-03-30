// @ts-nocheck
const express = require("express");
const {
  listProcesses,
  getProcessCatalog,
  getInterpreterCatalog,
  startProcess,
  stopProcess,
  restartProcess,
  runBulkAction,
  updateProcessEnv,
  deleteProcess,
  createProcess,
  getProcessLogs,
  reloadProcess,
  flushLogs,
  getProcessDetails,
  npmInstall,
  npmBuild,
  updateProcessMetadata,
  removeProcessMetadata,
  readProcessMetrics,
  readMonitoringSummary,
  exportProcessConfig,
  importProcessConfig,
  deployProcess,
  getDeploymentHistory,
  getGitCommitsForProcess,
  gitPullProcess,
  rollbackProcess,
  readProcessDotEnv,
  updateProcessDotEnv
} = require("../controllers/processController");
const { verifyToken } = require("../middleware/auth");
const { validateProcessParam } = require("../middleware/validate");
const { asyncHandler } = require("../middleware/asyncHandler");
const {
  readLimiter,
  writeLimiter,
  criticalWriteLimiter
} = require("../middleware/rateLimit");
const { listHistory, listHistoryPage } = require("../utils/restartHistory");
const { listAuditPage } = require("../utils/auditTrail");
const { getRequestIp } = require("../utils/ipAccess");

const router = express.Router();

router.use(verifyToken);

router.get("/", readLimiter, asyncHandler(async (_req, res) => {
  const result = await listProcesses();
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/catalog", readLimiter, asyncHandler(async (_req, res) => {
  const result = await getProcessCatalog();
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/interpreters", readLimiter, asyncHandler(async (_req, res) => {
  const result = await getInterpreterCatalog();
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/history/restarts", readLimiter, asyncHandler(async (req, res) => {
  const hasPageQuery = req.query.page !== undefined || req.query.pageSize !== undefined;
  if (hasPageQuery) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 25));
    const processName = String(req.query.process || "").trim();
    const event = String(req.query.event || "").trim();
    const paged = await listHistoryPage({ page, pageSize, processName, event });
    res.json({ success: true, data: paged, error: null });
    return;
  }

  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested)
    ? Math.min(1000, Math.max(1, Math.floor(requested)))
    : 200;
  const items = await listHistory(limit);
  res.json({ success: true, data: items, error: null });
}));

router.get("/history/deployments", readLimiter, asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

  const hasPageQuery = req.query.page !== undefined || req.query.pageSize !== undefined;
  if (hasPageQuery) {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 25));
    const processName = String(req.query.process || "").trim();
    const result = await getDeploymentHistory({ page, pageSize, processName });
    res.status(result.success ? 200 : 500).json(result);
    return;
  }

  const rawLimit = String(req.query.limit || "100").trim().toLowerCase();
  const requested = Number(rawLimit);
  const limit = rawLimit === "all"
    ? 0
    : Number.isFinite(requested)
      ? Math.min(5000, Math.max(1, Math.floor(requested)))
      : 100;
  const processName = String(req.query.process || "").trim();
  const result = await getDeploymentHistory(limit, processName);
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/history/audit", readLimiter, asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 25));
  const action = String(req.query.action || "").trim();
  const processName = String(req.query.process || "").trim();
  const actor = String(req.query.actor || "").trim();
  const paged = await listAuditPage({ page, pageSize, action, processName, actor });
  res.json({ success: true, data: paged, error: null });
}));

router.get("/monitoring/summary", readLimiter, asyncHandler(async (_req, res) => {
  const result = await readMonitoringSummary();
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/config/export", readLimiter, asyncHandler(async (_req, res) => {
  const result = await exportProcessConfig();
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/config/import", writeLimiter, asyncHandler(async (req, res) => {
  const result = await importProcessConfig(req.body || {});
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/:name", readLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await getProcessDetails(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/:name/metrics", readLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const requested = Number(req.query.limit || 120);
  const limit = Number.isFinite(requested)
    ? Math.min(2000, Math.max(10, Math.floor(requested)))
    : 120;
  const result = await readProcessMetrics(req.params.name, limit);
  res.status(result.success ? 200 : 500).json(result);
}));

router.patch("/:name/meta", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await updateProcessMetadata(req.params.name, req.body || {});
  res.status(result.success ? 200 : 500).json(result);
}));

router.delete("/:name/meta", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await removeProcessMetadata(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/create", writeLimiter, asyncHandler(async (req, res) => {
  const result = await createProcess(req.body || {}, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req),
    io: req.app.get("io"),
    createOperationId: String(req.body?.create_operation_id || "").trim()
  });
  const status = result.success
    ? 200
    : /must|required|invalid|inside allowed|cannot contain|already in use|port must be|did not become healthy|restarted during startup/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/bulk-action", writeLimiter, asyncHandler(async (req, res) => {
  const result = await runBulkAction(req.body?.action, req.body?.names, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  const status = result.success
    ? 200
    : /must|required|invalid|unsupported|non-empty array/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/:name/start", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await startProcess(req.params.name, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  const status = result.success
    ? 200
    : /did not become healthy|restarted during startup|failed startup validation/i.test(result.error || "")
      ? 409
      : 500;
  res.status(status).json(result);
}));

router.post("/:name/stop", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await stopProcess(req.params.name, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/restart", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await restartProcess(req.params.name, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/reload", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await reloadProcess(req.params.name, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  res.status(result.success ? 200 : 500).json(result);
}));

router.patch("/:name/env", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await updateProcessEnv(
    req.params.name,
    req.body?.env || {},
    { replace: Boolean(req.body?.replace) },
    {
      actor: req.user?.username || "unknown",
      ip: getRequestIp(req)
    }
  );
  const status = result.success ? 200 : /must|required|invalid|env/i.test(result.error || "") ? 400 : 500;
  res.status(status).json(result);
}));

router.get("/:name/dotenv", readLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await readProcessDotEnv(req.params.name);
  const status = result.success
    ? 200
    : /restricted/i.test(result.error || "")
      ? 403
      : /not found|working directory|process/i.test(result.error || "")
        ? 404
        : 500;
  res.status(status).json(result);
}));

router.patch("/:name/dotenv", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await updateProcessDotEnv(req.params.name, req.body || {}, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  const status = result.success
    ? 200
    : /restricted/i.test(result.error || "")
      ? 403
      : /must|required|invalid|env|writable|not found/i.test(result.error || "")
        ? 400
        : 500;
  res.status(status).json(result);
}));

router.delete("/:name", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await deleteProcess(req.params.name, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/:name/logs", readLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const requested = Number(req.query.lines || 100);
  const lines = Number.isFinite(requested)
    ? Math.min(2000, Math.max(1, Math.floor(requested)))
    : 100;
  const result = await getProcessLogs(req.params.name, lines);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/flush", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await flushLogs(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/npm-install", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await npmInstall(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/npm-build", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await npmBuild(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/deploy", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await deployProcess(req.params.name, req.body || {}, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/:name/git/commits", readLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const requested = Number(req.query.limit || 20);
  const limit = Number.isFinite(requested)
    ? Math.min(100, Math.max(1, Math.floor(requested)))
    : 20;
  const result = await getGitCommitsForProcess(req.params.name, limit);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/git/pull", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await gitPullProcess(req.params.name);
  const status = result.success
    ? 200
    : /not in a git repository|not found|working directory/i.test(result.error || "")
      ? 400
      : 500;
  res.status(status).json(result);
}));

router.post("/:name/rollback", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await rollbackProcess(req.params.name, req.body || {}, {
    actor: req.user?.username || "unknown",
    ip: getRequestIp(req)
  });
  res.status(result.success ? 200 : 500).json(result);
}));

module.exports = router;


const express = require("express");
const {
  listProcesses,
  startProcess,
  stopProcess,
  restartProcess,
  deleteProcess,
  createProcess,
  getProcessLogs,
  reloadProcess,
  flushLogs,
  getProcessDetails,
  npmInstall,
  npmBuild
} = require("../controllers/processController");
const { verifyToken } = require("../middleware/auth");
const { validateProcessParam } = require("../middleware/validate");
const { asyncHandler } = require("../middleware/asyncHandler");
const {
  readLimiter,
  writeLimiter,
  criticalWriteLimiter
} = require("../middleware/rateLimit");
const { listHistory } = require("../utils/restartHistory");

const router = express.Router();

router.use(verifyToken);

router.get("/", readLimiter, asyncHandler(async (_req, res) => {
  const result = await listProcesses();
  res.status(result.success ? 200 : 500).json(result);
}));

router.get("/history/restarts", readLimiter, asyncHandler(async (req, res) => {
  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested)
    ? Math.min(1000, Math.max(1, Math.floor(requested)))
    : 200;
  const items = await listHistory(limit);
  res.json({ success: true, data: items, error: null });
}));

router.get("/:name", readLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await getProcessDetails(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/create", writeLimiter, asyncHandler(async (req, res) => {
  const result = await createProcess(req.body || {});
  const status = result.success ? 200 : /must|required|invalid|inside allowed|cannot contain/i.test(result.error || "") ? 400 : 500;
  res.status(status).json(result);
}));

router.post("/:name/start", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await startProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/stop", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await stopProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/restart", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await restartProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/:name/reload", writeLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await reloadProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
}));

router.delete("/:name", criticalWriteLimiter, validateProcessParam, asyncHandler(async (req, res) => {
  const result = await deleteProcess(req.params.name);
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

module.exports = router;

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
  getProcessDetails
} = require("../controllers/processController");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

router.use(verifyToken);

router.get("/", async (_req, res) => {
  const result = await listProcesses();
  res.status(result.success ? 200 : 500).json(result);
});

router.get("/:name", async (req, res) => {
  const result = await getProcessDetails(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

router.post("/create", async (req, res) => {
  const result = await createProcess(req.body || {});
  res.status(result.success ? 200 : 500).json(result);
});

router.post("/:name/start", async (req, res) => {
  const result = await startProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

router.post("/:name/stop", async (req, res) => {
  const result = await stopProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

router.post("/:name/restart", async (req, res) => {
  const result = await restartProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

router.post("/:name/reload", async (req, res) => {
  const result = await reloadProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

router.delete("/:name", async (req, res) => {
  const result = await deleteProcess(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

router.get("/:name/logs", async (req, res) => {
  const lines = Number(req.query.lines || 100);
  const result = await getProcessLogs(req.params.name, lines);
  res.status(result.success ? 200 : 500).json(result);
});

router.post("/:name/flush", async (req, res) => {
  const result = await flushLogs(req.params.name);
  res.status(result.success ? 200 : 500).json(result);
});

module.exports = router;

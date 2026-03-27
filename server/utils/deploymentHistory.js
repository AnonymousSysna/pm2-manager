const fs = require("fs");
const path = require("path");

const DEFAULT_HISTORY_PATH = path.resolve(__dirname, "../../logs/deploy-history.jsonl");
const MAX_LINES = Number.isFinite(Number(process.env.DEPLOY_HISTORY_MAX_LINES))
  ? Math.max(100, Math.floor(Number(process.env.DEPLOY_HISTORY_MAX_LINES)))
  : 5000;
const MAX_BYTES = Number.isFinite(Number(process.env.DEPLOY_HISTORY_MAX_BYTES))
  ? Math.max(512 * 1024, Math.floor(Number(process.env.DEPLOY_HISTORY_MAX_BYTES)))
  : 5 * 1024 * 1024;
let rotateInProgress = false;

function getHistoryPath() {
  const configured = String(process.env.DEPLOY_HISTORY_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_HISTORY_PATH;
}

async function ensureDir() {
  const filePath = getHistoryPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

async function appendDeploymentHistory(entry) {
  const filePath = await ensureDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  });
  await fs.promises.appendFile(filePath, `${line}\n`, "utf8");
  maybeRotate(filePath).catch(() => {
    // Best-effort rotation.
  });
}

async function maybeRotate(filePath) {
  if (rotateInProgress) {
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_error) {
    return;
  }

  if (stat.size <= MAX_BYTES) {
    return;
  }

  rotateInProgress = true;
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const trimmed = lines.slice(-MAX_LINES);
    await fs.promises.writeFile(filePath, `${trimmed.join("\n")}\n`, "utf8");
  } finally {
    rotateInProgress = false;
  }
}

async function listDeploymentHistory(limit = 100, processName = "") {
  const filePath = getHistoryPath();
  let raw = "";
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
  const normalizedProcessName = String(processName || "").trim();

  const items = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .filter((item) => !normalizedProcessName || item.processName === normalizedProcessName);

  return items.slice(-normalizedLimit);
}

module.exports = {
  appendDeploymentHistory,
  listDeploymentHistory
};

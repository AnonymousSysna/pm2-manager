const fs = require("fs");
const path = require("path");

const DEFAULT_HISTORY_PATH = path.resolve(__dirname, "../../logs/restart-history.jsonl");
const MAX_HISTORY_LINES = Number.isFinite(Number(process.env.RESTART_HISTORY_MAX_LINES))
  ? Math.max(100, Math.floor(Number(process.env.RESTART_HISTORY_MAX_LINES)))
  : 20_000;
const MAX_HISTORY_BYTES = Number.isFinite(Number(process.env.RESTART_HISTORY_MAX_BYTES))
  ? Math.max(512 * 1024, Math.floor(Number(process.env.RESTART_HISTORY_MAX_BYTES)))
  : 10 * 1024 * 1024;
let rotateInProgress = false;

function getHistoryPath() {
  const configured = String(process.env.RESTART_HISTORY_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_HISTORY_PATH;
}

async function ensureHistoryDir() {
  const filePath = getHistoryPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

async function appendHistoryEntry(entry) {
  const filePath = await ensureHistoryDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  });
  await fs.promises.appendFile(filePath, `${line}\n`, "utf8");
  maybeRotateHistory(filePath).catch(() => {
    // Best-effort rotation.
  });
}

async function maybeRotateHistory(filePath) {
  if (rotateInProgress) {
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_error) {
    return;
  }

  if (stat.size <= MAX_HISTORY_BYTES) {
    return;
  }

  rotateInProgress = true;
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const trimmed = lines.slice(-MAX_HISTORY_LINES);
    await fs.promises.writeFile(filePath, `${trimmed.join("\n")}\n`, "utf8");
  } finally {
    rotateInProgress = false;
  }
}

async function listHistory(limit = 200) {
  const filePath = getHistoryPath();
  let raw = "";
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    return [];
  }

  const lines = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(1000, Number(limit) || 200)));

  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  appendHistoryEntry,
  listHistory
};

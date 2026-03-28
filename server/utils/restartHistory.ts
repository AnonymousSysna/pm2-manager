// @ts-nocheck
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
const PROJECT_ROOT = path.resolve(__dirname, "../../");

function getHistoryPath() {
  const configured = String(process.env.RESTART_HISTORY_PATH || "").trim();
  if (!configured) {
    return DEFAULT_HISTORY_PATH;
  }

  const defaultFileName = path.basename(DEFAULT_HISTORY_PATH);
  if (configured === "." || configured === "./" || configured === ".\\") {
    return path.join(PROJECT_ROOT, defaultFileName);
  }

  const resolved = path.isAbsolute(configured)
    ? configured
    : path.resolve(PROJECT_ROOT, configured);

  try {
    if (fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, defaultFileName);
    }
  } catch (_error) {
    // Path may not exist yet; treat as file path.
  }

  return resolved;
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

async function listHistoryPage({
  page = 1,
  pageSize = 25,
  processName = "",
  event = ""
} = {}) {
  const filePath = getHistoryPath();
  let raw = "";
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    return {
      items: [],
      pagination: {
        page: 1,
        pageSize: Math.max(1, Math.min(100, Number(pageSize) || 25)),
        totalItems: 0,
        totalPages: 1
      }
    };
  }

  const normalizedPageSize = Math.max(1, Math.min(100, Number(pageSize) || 25));
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedProcessName = String(processName || "").trim();
  const normalizedEvent = String(event || "").trim().toLowerCase();

  const allItems = raw
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
    .filter((item) => !normalizedProcessName || item.processName === normalizedProcessName)
    .filter((item) => !normalizedEvent || String(item.event || "").toLowerCase() === normalizedEvent)
    .reverse();

  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
  const safePage = Math.min(normalizedPage, totalPages);
  const start = (safePage - 1) * normalizedPageSize;
  const items = allItems.slice(start, start + normalizedPageSize);

  return {
    items,
    pagination: {
      page: safePage,
      pageSize: normalizedPageSize,
      totalItems,
      totalPages
    }
  };
}

module.exports = {
  appendHistoryEntry,
  listHistory,
  listHistoryPage
};


const fs = require("fs");
const path = require("path");

const DEFAULT_AUDIT_PATH = path.resolve(__dirname, "../../logs/audit-trail.jsonl");
const MAX_AUDIT_LINES = Number.isFinite(Number(process.env.AUDIT_TRAIL_MAX_LINES))
  ? Math.max(500, Math.floor(Number(process.env.AUDIT_TRAIL_MAX_LINES)))
  : 50_000;
const MAX_AUDIT_BYTES = Number.isFinite(Number(process.env.AUDIT_TRAIL_MAX_BYTES))
  ? Math.max(1024 * 1024, Math.floor(Number(process.env.AUDIT_TRAIL_MAX_BYTES)))
  : 25 * 1024 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, "../../");
let rotateInProgress = false;

function getAuditPath() {
  const configured = String(process.env.AUDIT_TRAIL_PATH || "").trim();
  if (!configured) {
    return DEFAULT_AUDIT_PATH;
  }

  const defaultFileName = path.basename(DEFAULT_AUDIT_PATH);
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

async function ensureAuditDir() {
  const filePath = getAuditPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

async function appendAuditEntry(entry = {}) {
  const filePath = await ensureAuditDir();
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...entry
  });
  await fs.promises.appendFile(filePath, `${line}\n`, "utf8");
  maybeRotateAudit(filePath).catch(() => {
    // Best-effort rotation.
  });
}

async function maybeRotateAudit(filePath) {
  if (rotateInProgress) {
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (_error) {
    return;
  }

  if (stat.size <= MAX_AUDIT_BYTES) {
    return;
  }

  rotateInProgress = true;
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const trimmed = lines.slice(-MAX_AUDIT_LINES);
    await fs.promises.writeFile(filePath, `${trimmed.join("\n")}\n`, "utf8");
  } finally {
    rotateInProgress = false;
  }
}

async function listAuditPage({
  page = 1,
  pageSize = 25,
  action = "",
  processName = "",
  actor = ""
} = {}) {
  const filePath = getAuditPath();
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
  const normalizedAction = String(action || "").trim().toLowerCase();
  const normalizedProcessName = String(processName || "").trim();
  const normalizedActor = String(actor || "").trim().toLowerCase();

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
    .filter((item) => !normalizedAction || String(item.action || "").toLowerCase() === normalizedAction)
    .filter((item) => !normalizedProcessName || String(item.processName || "") === normalizedProcessName)
    .filter((item) => !normalizedActor || String(item.actor || "").toLowerCase() === normalizedActor)
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
  appendAuditEntry,
  listAuditPage
};

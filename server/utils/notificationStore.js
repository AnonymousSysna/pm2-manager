const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_NOTIFICATIONS_PATH = path.resolve(__dirname, "../../logs/notifications.jsonl");
const MAX_LINES = Number.isFinite(Number(process.env.NOTIFICATION_MAX_LINES))
  ? Math.max(200, Math.floor(Number(process.env.NOTIFICATION_MAX_LINES)))
  : 20_000;
const MAX_BYTES = Number.isFinite(Number(process.env.NOTIFICATION_MAX_BYTES))
  ? Math.max(512 * 1024, Math.floor(Number(process.env.NOTIFICATION_MAX_BYTES)))
  : 10 * 1024 * 1024;
let rotateInProgress = false;

function getPath() {
  const configured = String(process.env.NOTIFICATION_HISTORY_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_NOTIFICATIONS_PATH;
}

async function ensureDir() {
  const filePath = getPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

async function appendNotification(entry) {
  const filePath = await ensureDir();
  const payload = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    level: "info",
    category: "event",
    title: "",
    message: "",
    processName: null,
    details: null,
    ...entry
  };

  await fs.promises.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  maybeRotate(filePath).catch(() => {
    // Best-effort rotation.
  });
  return payload;
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

async function listNotifications(limit = 200) {
  const filePath = getPath();
  let raw = "";
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.min(2000, Number(limit) || 200));
  return raw
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
    .slice(-normalizedLimit);
}

async function clearNotifications() {
  const filePath = await ensureDir();
  await fs.promises.writeFile(filePath, "", "utf8");
  return { cleared: true };
}

module.exports = {
  appendNotification,
  listNotifications,
  clearNotifications
};

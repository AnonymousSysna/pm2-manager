// @ts-nocheck
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_STORE_PATH = path.resolve(__dirname, "../../logs/alert-channels.json");
const ALLOWED_TYPES = new Set(["webhook", "slack"]);
const ALLOWED_SEVERITIES = new Set(["info", "warning", "danger"]);

function getStorePath() {
  const configured = String(process.env.ALERT_CHANNELS_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_STORE_PATH;
}

async function ensureDir() {
  const filePath = getStorePath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

function sanitizeChannel(input = {}) {
  const type = String(input.type || "webhook").trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("channel type must be webhook or slack");
  }

  const url = String(input.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("channel url must be http/https");
  }

  const name = String(input.name || type).trim().slice(0, 64);
  const minSeverity = String(input.minSeverity || "warning").trim().toLowerCase();
  if (!ALLOWED_SEVERITIES.has(minSeverity)) {
    throw new Error("minSeverity must be info, warning, or danger");
  }

  return {
    id: String(input.id || crypto.randomUUID()),
    name,
    type,
    url,
    enabled: input.enabled !== false,
    minSeverity
  };
}

async function loadStore() {
  const filePath = await ensureDir();
  let raw = "";
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    return { filePath, data: { channels: [] } };
  }

  try {
    const parsed = JSON.parse(raw);
    const channels = Array.isArray(parsed.channels) ? parsed.channels : [];
    return { filePath, data: { channels } };
  } catch (_error) {
    return { filePath, data: { channels: [] } };
  }
}

async function saveStore(filePath, data) {
  await fs.promises.writeFile(
    filePath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        ...data
      },
      null,
      2
    ),
    "utf8"
  );
}

async function listAlertChannels() {
  const { data } = await loadStore();
  const channels = [];
  for (const channel of data.channels || []) {
    try {
      channels.push(sanitizeChannel(channel));
    } catch (_error) {
      // Skip invalid entries.
    }
  }
  return channels;
}

async function upsertAlertChannel(channelInput) {
  const nextChannel = sanitizeChannel(channelInput);
  const { filePath, data } = await loadStore();

  const index = (data.channels || []).findIndex((item) => String(item.id || "") === nextChannel.id);
  if (index >= 0) {
    data.channels[index] = nextChannel;
  } else {
    data.channels.push(nextChannel);
  }

  await saveStore(filePath, data);
  return nextChannel;
}

async function removeAlertChannel(channelId) {
  const id = String(channelId || "").trim();
  if (!id) {
    throw new Error("channelId is required");
  }

  const { filePath, data } = await loadStore();
  data.channels = (data.channels || []).filter((item) => String(item.id || "") !== id);
  await saveStore(filePath, data);
  return { removed: true };
}

module.exports = {
  listAlertChannels,
  upsertAlertChannel,
  removeAlertChannel
};


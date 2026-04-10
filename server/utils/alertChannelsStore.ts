const fs = require("fs");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const DEFAULT_STORE_PATH = path.resolve(__dirname, "../../logs/alert-channels.json");
const ALLOWED_TYPES = new Set(["webhook", "slack"]);
const ALLOWED_SEVERITIES = new Set(["info", "warning", "danger"]);
let writeQueue = Promise.resolve();

function sanitizeDeliveryStats(input = {}) {
  const failureDate = input.lastFailureAt ? new Date(input.lastFailureAt) : null;
  const successDate = input.lastSuccessAt ? new Date(input.lastSuccessAt) : null;
  return {
    failedDeliveries: Math.max(0, Number(input.failedDeliveries) || 0),
    successfulDeliveries: Math.max(0, Number(input.successfulDeliveries) || 0),
    lastFailureAt: failureDate && !Number.isNaN(failureDate.getTime()) ? failureDate.toISOString() : null,
    lastSuccessAt: successDate && !Number.isNaN(successDate.getTime()) ? successDate.toISOString() : null,
    lastError: input.lastError ? String(input.lastError).slice(0, 500) : null
  };
}

function getStorePath() {
  const configured = String(process.env.ALERT_CHANNELS_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_STORE_PATH;
}

async function ensureDir() {
  const filePath = getStorePath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

function parseIPv4(value) {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const numeric = Number(part);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
      return null;
    }
    octets.push(numeric);
  }
  return octets;
}

function isPrivateIPv4(ip) {
  const octets = parseIPv4(ip);
  if (!octets) {
    return false;
  }
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a >= 224) {
    return true;
  }
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = String(ip || "").toLowerCase().split("%")[0];
  if (!normalized) {
    return false;
  }
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isPrivateIPv4(mapped);
  }
  return false;
}

function isBlockedIpLiteral(hostname) {
  const ipType = net.isIP(hostname);
  if (ipType === 4) {
    return isPrivateIPv4(hostname);
  }
  if (ipType === 6) {
    return isPrivateIPv6(hostname);
  }
  return false;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

function validateAlertChannelUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(String(urlString || "").trim());
  } catch (_error) {
    throw new Error("channel url must be a valid URL");
  }

  const protocol = String(parsed.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("channel url must be http/https");
  }

  if (isBlockedHostname(parsed.hostname) || isBlockedIpLiteral(parsed.hostname)) {
    throw new Error("channel url targets a restricted hostname");
  }

  return parsed.toString();
}

function sanitizeChannel(input = {}) {
  const type = String(input.type || "webhook").trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("channel type must be webhook or slack");
  }

  const url = validateAlertChannelUrl(input.url);

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
    minSeverity,
    deliveryStats: sanitizeDeliveryStats(input.deliveryStats || {})
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

function enqueueWrite(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => {
    // Keep queue alive after failure.
  });
  return run;
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
  return enqueueWrite(async () => {
    const { filePath, data } = await loadStore();
    const nextChannel = sanitizeChannel(channelInput);

    const index = (data.channels || []).findIndex((item) => String(item.id || "") === nextChannel.id);
    if (index >= 0) {
      const current = sanitizeChannel(data.channels[index]);
      data.channels[index] = {
        ...nextChannel,
        deliveryStats: current.deliveryStats
      };
    } else {
      data.channels.push(nextChannel);
    }

    await saveStore(filePath, data);
    return index >= 0 ? data.channels[index] : nextChannel;
  });
}

async function removeAlertChannel(channelId) {
  const id = String(channelId || "").trim();
  if (!id) {
    throw new Error("channelId is required");
  }

  return enqueueWrite(async () => {
    const { filePath, data } = await loadStore();
    data.channels = (data.channels || []).filter((item) => String(item.id || "") !== id);
    await saveStore(filePath, data);
    return { removed: true };
  });
}

async function recordAlertChannelDelivery(channelId, delivery = {}) {
  const id = String(channelId || "").trim();
  if (!id) {
    return null;
  }

  return enqueueWrite(async () => {
    const { filePath, data } = await loadStore();
    const channels = Array.isArray(data.channels) ? data.channels : [];
    const index = channels.findIndex((item) => String(item?.id || "") === id);
    if (index < 0) {
      return null;
    }

    const current = sanitizeChannel(channels[index]);
    const stats = sanitizeDeliveryStats(current.deliveryStats || {});
    const success = Boolean(delivery.success);
    const timestamp = delivery.ts ? new Date(delivery.ts).toISOString() : new Date().toISOString();

    if (success) {
      stats.successfulDeliveries += 1;
      stats.lastSuccessAt = timestamp;
      stats.lastError = null;
    } else {
      stats.failedDeliveries += 1;
      stats.lastFailureAt = timestamp;
      stats.lastError = delivery.error ? String(delivery.error).slice(0, 500) : "Alert delivery failed";
    }

    channels[index] = {
      ...current,
      deliveryStats: stats
    };
    data.channels = channels;
    await saveStore(filePath, data);
    return channels[index];
  });
}

module.exports = {
  listAlertChannels,
  upsertAlertChannel,
  removeAlertChannel,
  recordAlertChannelDelivery
};


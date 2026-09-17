const { redactSecretsFromText, scrubUrl } = require("./urlSafety");

const SENSITIVE_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|private|credential|auth|cookie|session|jwt|pwd)/i;
const MAX_STRING_LENGTH = Number.isFinite(Number(process.env.LOG_FIELD_MAX_LENGTH))
  ? Math.max(200, Math.floor(Number(process.env.LOG_FIELD_MAX_LENGTH)))
  : 2000;

function nowIso() {
  return new Date().toISOString();
}

function truncateString(value) {
  const text = String(value || "");
  if (text.length <= MAX_STRING_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_STRING_LENGTH)}...[truncated]`;
}

function serializeError(error) {
  if (!error) {
    return null;
  }
  return {
    message: truncateString(error.message || String(error)),
    stack: process.env.NODE_ENV === "production" ? undefined : truncateString(error.stack || ""),
    name: error.name || "Error"
  };
}

function redactValue(key, value, depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(String(key || ""))) {
    return "[redacted]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === "string") {
    const redacted = redactSecretsFromText(value);
    const safeValue = redacted.includes("?") || redacted.startsWith("http://") || redacted.startsWith("https://")
      ? scrubUrl(redacted)
      : redacted;
    return truncateString(safeValue);
  }

  if (typeof value !== "object") {
    return value;
  }

  if (depth >= 4) {
    return "[max-depth]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue("", item, depth + 1));
  }

  const output = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    output[childKey] = redactValue(childKey, childValue, depth + 1);
  }
  return output;
}

function sanitizeMeta(meta = {}) {
  if (!meta || typeof meta !== "object") {
    return {};
  }
  return redactValue("", meta) || {};
}

function write(level, message, meta = {}) {
  const payload = {
    ts: nowIso(),
    level,
    msg: String(message || "log"),
    ...sanitizeMeta(meta)
  };
  const line = JSON.stringify(payload);
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

const logger = {
  info(message, meta) {
    write("info", message, meta);
  },
  warn(message, meta) {
    write("warn", message, meta);
  },
  error(message, meta) {
    write("error", message, meta);
  },
  debug(message, meta) {
    if (String(process.env.LOG_LEVEL || "info").toLowerCase() === "debug") {
      write("debug", message, meta);
    }
  },
  serializeError
};

module.exports = { logger, serializeError, sanitizeMeta };

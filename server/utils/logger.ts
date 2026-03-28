// @ts-nocheck
function nowIso() {
  return new Date().toISOString();
}

function serializeError(error) {
  if (!error) {
    return null;
  }
  return {
    message: error.message,
    stack: error.stack,
    name: error.name
  };
}

function write(level, message, meta = {}) {
  const payload = {
    ts: nowIso(),
    level,
    msg: message,
    ...meta
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
    write("debug", message, meta);
  },
  serializeError
};

module.exports = { logger, serializeError };


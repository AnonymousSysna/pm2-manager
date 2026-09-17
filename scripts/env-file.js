const fs = require("fs");
const path = require("path");

const DEFAULT_ENV = "production";

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const values = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Mirrors server/utils/envLoad.ts ordering so PM2-managed starts and a bare
 * `npm start` resolve the same values: env-specific files beat the base file,
 * and a real process env beats every file.
 */
function resolveEnvFilePaths({ appRoot, serverRoot = path.join(appRoot, "server"), nodeEnv, exists = fs.existsSync }) {
  const resolvedEnv = String(nodeEnv || "").trim().toLowerCase();
  return [
    resolvedEnv ? path.join(serverRoot, `.env.${resolvedEnv}`) : "",
    resolvedEnv ? path.join(appRoot, `.env.${resolvedEnv}`) : "",
    path.join(serverRoot, ".env"),
    path.join(appRoot, ".env")
  ]
    .filter(Boolean)
    .filter((file) => exists(file));
}

function buildProcessEnv({ appRoot, serverRoot, nodeEnv, env = process.env, exists = fs.existsSync } = {}) {
  const resolvedEnv = String(nodeEnv || env.NODE_ENV || DEFAULT_ENV).trim().toLowerCase() || DEFAULT_ENV;
  const merged = {};
  // resolveEnvFilePaths lists most specific first; merge in reverse so the most
  // specific file is applied last and wins.
  const files = resolveEnvFilePaths({ appRoot, serverRoot, nodeEnv: resolvedEnv, exists });
  for (const file of files.slice().reverse()) {
    Object.assign(merged, parseEnvFile(file));
  }
  return { nodeEnv: resolvedEnv, values: merged };
}

module.exports = {
  DEFAULT_ENV,
  buildProcessEnv,
  parseEnvFile,
  resolveEnvFilePaths
};

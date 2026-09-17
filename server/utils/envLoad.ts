const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const KNOWN_NODE_ENVS = ["development", "test", "staging", "production"];
const BASE_ENV_FILE = ".env";

function normalizeNodeEnv(value) {
  const text = String(value || "").trim().toLowerCase();
  return KNOWN_NODE_ENVS.includes(text) ? text : "";
}

/**
 * Environment files are loaded most-specific-first because dotenv never overrides
 * variables that are already set. That ordering gives us:
 *   real process env (PM2/systemd/shell)  >  .env.<NODE_ENV>  >  .env
 * and lets server/ override the repo root.
 */
function resolveEnvFilePaths({ rootDir, serverDir, nodeEnv, exists = fs.existsSync }) {
  const resolvedEnv = normalizeNodeEnv(nodeEnv);
  const candidates = [
    resolvedEnv ? path.join(serverDir, `${BASE_ENV_FILE}.${resolvedEnv}`) : "",
    resolvedEnv ? path.join(rootDir, `${BASE_ENV_FILE}.${resolvedEnv}`) : "",
    path.join(serverDir, BASE_ENV_FILE),
    path.join(rootDir, BASE_ENV_FILE)
  ].filter(Boolean);

  return candidates.filter((file) => exists(file));
}

function readDeclaredValue(filePaths, key, readFile = (file) => fs.readFileSync(file, "utf8")) {
  for (const file of filePaths) {
    try {
      const parsed = dotenv.parse(readFile(file));
      if (parsed[key] !== undefined && String(parsed[key]).trim()) {
        return String(parsed[key]).trim();
      }
    } catch (_error) {
      // An unreadable file is reported by the caller as "not loaded".
    }
  }
  return "";
}

/**
 * Resolves which NODE_ENV applies before choosing environment files, so
 * `.env.production` is honored even when NODE_ENV is only declared inside `.env`.
 */
function resolveNodeEnv({ rootDir, serverDir, env = process.env, exists }) {
  const fromProcess = normalizeNodeEnv(env.NODE_ENV);
  if (fromProcess) {
    return fromProcess;
  }
  const baseFiles = resolveEnvFilePaths({ rootDir, serverDir, nodeEnv: "", exists });
  return normalizeNodeEnv(readDeclaredValue(baseFiles, "NODE_ENV")) || "development";
}

/**
 * Loads base + environment-specific files into process.env without clobbering
 * variables that the runtime already provided.
 */
function loadEnvironmentFiles({ rootDir, serverDir, env = process.env, exists = fs.existsSync }) {
  const nodeEnv = resolveNodeEnv({ rootDir, serverDir, env, exists });
  const filePaths = resolveEnvFilePaths({ rootDir, serverDir, nodeEnv, exists });
  const loaded = [];

  for (const file of filePaths) {
    const result = dotenv.config({ path: file, override: false, processEnv: env });
    if (!result.error) {
      loaded.push(file);
    }
  }

  if (!env.NODE_ENV) {
    env.NODE_ENV = nodeEnv;
  }

  return { nodeEnv, loaded };
}

module.exports = {
  BASE_ENV_FILE,
  KNOWN_NODE_ENVS,
  loadEnvironmentFiles,
  normalizeNodeEnv,
  readDeclaredValue,
  resolveEnvFilePaths,
  resolveNodeEnv
};

#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const appDir = path.resolve(__dirname, "..");
const envPath = path.join(appDir, ".env");
const envExamplePath = path.join(appDir, ".env.example");

const PLACEHOLDER_PATTERNS = [
  /^replace_/i,
  /replace[_-]?with/i,
  /^changeme$/i,
  /^change[-_]?this/i,
  /^your[-_]?secret/i,
  /^dev[-_]?secret/i,
  /^admin$/i,
  /^\$2[aby]\$\d{2}\$replace_/i
];

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function isStrongSecret(value) {
  const text = String(value || "").trim();
  return text.length >= 32 && !isPlaceholder(text);
}

function parseEnv(content) {
  const values = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
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

function serializeValue(value) {
  const text = String(value ?? "");
  if (!text || /[\s#"'`$\\]/.test(text)) {
    return JSON.stringify(text);
  }
  return text;
}

function upsertEnv(content, updates, removals = []) {
  const removeSet = new Set(removals);
  const pending = { ...updates };
  const lines = String(content || "").split(/\r?\n/);
  const nextLines = [];

  for (const rawLine of lines) {
    const match = rawLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) {
      nextLines.push(rawLine);
      continue;
    }

    const key = match[1];
    if (removeSet.has(key)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(pending, key)) {
      nextLines.push(`${key}=${serializeValue(pending[key])}`);
      delete pending[key];
    } else {
      nextLines.push(rawLine);
    }
  }

  if (Object.keys(pending).length > 0 && nextLines[nextLines.length - 1] !== "") {
    nextLines.push("");
  }
  for (const [key, value] of Object.entries(pending)) {
    nextLines.push(`${key}=${serializeValue(value)}`);
  }

  return nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function createPasswordHash(plainPassword) {
  const bcryptPath = path.join(appDir, "server", "node_modules", "bcryptjs");
  try {
    const bcrypt = require(bcryptPath);
    return bcrypt.hashSync(plainPassword, 10);
  } catch (error) {
    const hint = fs.existsSync(path.join(appDir, "server", "package.json"))
      ? "Run npm --prefix server install, then retry."
      : "Server dependencies are missing.";
    throw new Error(`Unable to generate PM2_PASS_HASH. ${hint} ${error.message}`);
  }
}

function getCandidatePm2DumpPaths() {
  return Array.from(new Set([
    process.env.PM2_HOME ? path.join(process.env.PM2_HOME, "dump.pm2") : "",
    path.join(os.homedir(), ".pm2", "dump.pm2")
  ].filter(Boolean)));
}

function recoverEnvFromPm2Dump() {
  const wantedKeys = new Set([
    "PM2_USER",
    "PM2_PASS_HASH",
    "JWT_SECRET",
    "METRICS_TOKEN",
    "PORT",
    "PM2_MANAGER_PUBLIC_PORT",
    "PM2_MANAGER_DOMAIN",
    "APP_PUBLIC_URL",
    "CORS_ALLOWED_ORIGINS",
    "PROJECTS_ROOT",
    "TRUST_PROXY",
    "COOKIE_SECURE",
    "COOKIE_SAME_SITE"
  ]);

  for (const dumpPath of getCandidatePm2DumpPaths()) {
    if (!fs.existsSync(dumpPath)) continue;
    try {
      const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
      const apps = Array.isArray(dump) ? dump : Array.isArray(dump?.apps) ? dump.apps : [];
      const app = apps.find((entry) => {
        const env = entry?.pm2_env || entry || {};
        return env.name === "pm2-dashboard" || env.PM2_MANAGER_PROCESS_NAME === "pm2-dashboard";
      });
      const env = { ...(app?.pm2_env?.env || {}), ...(app?.pm2_env || {}), ...(app?.env || {}) };
      const recovered = {};
      for (const key of wantedKeys) {
        if (env[key] !== undefined && String(env[key]).trim()) {
          recovered[key] = String(env[key]).trim();
        }
      }
      if (Object.keys(recovered).length > 0) {
        return recovered;
      }
    } catch (_error) {
      // Ignore corrupt PM2 dump files. Missing values will be generated below.
    }
  }
  return {};
}

function loadBaseEnvContent() {
  if (fs.existsSync(envPath)) {
    return fs.readFileSync(envPath, "utf8");
  }
  if (fs.existsSync(envExamplePath)) {
    return fs.readFileSync(envExamplePath, "utf8");
  }
  return "";
}

function buildDefaultPublicUrl(values) {
  const port = String(values.PORT || process.env.PORT || "8000").trim() || "8000";
  const domain = String(values.PM2_MANAGER_DOMAIN || process.env.PM2_MANAGER_DOMAIN || "").trim();
  if (domain) {
    const publicPort = String(values.PM2_MANAGER_PUBLIC_PORT || process.env.PM2_MANAGER_PUBLIC_PORT || port).trim() || port;
    return `https://${domain}:${publicPort}`;
  }
  return `http://localhost:${port}`;
}

function ensureRuntimeEnv(options = {}) {
  const content = loadBaseEnvContent();
  const recoveredValues = recoverEnvFromPm2Dump();
  const values = parseEnv(content);
  const updates = {};
  const removals = [];
  const generated = {};

  for (const [key, value] of Object.entries(recoveredValues)) {
    if (isPlaceholder(values[key])) {
      values[key] = value;
      updates[key] = value;
    }
  }

  if (isPlaceholder(values.PM2_USER)) {
    updates.PM2_USER = `admin_${randomHex(3)}`;
    generated.PM2_USER = updates.PM2_USER;
  }

  const existingPlainPassword = String(values.PM2_PASS || "").trim();
  const needsHash = isPlaceholder(values.PM2_PASS_HASH) || !/^\$2[aby]\$\d{2}\$.{53}$/.test(String(values.PM2_PASS_HASH || "").trim());
  if (needsHash) {
    const plainPassword = !isPlaceholder(existingPlainPassword) ? existingPlainPassword : randomPassword();
    updates.PM2_PASS_HASH = createPasswordHash(plainPassword);
    removals.push("PM2_PASS");
    if (isPlaceholder(existingPlainPassword)) {
      generated.PM2_PASS = plainPassword;
    }
  }

  if (!isStrongSecret(values.JWT_SECRET)) {
    updates.JWT_SECRET = randomHex(32);
    generated.JWT_SECRET = true;
  }
  if (!isStrongSecret(values.METRICS_TOKEN)) {
    updates.METRICS_TOKEN = randomHex(32);
    generated.METRICS_TOKEN = true;
  }

  if (isPlaceholder(values.NODE_ENV)) updates.NODE_ENV = "production";
  if (isPlaceholder(values.PORT)) updates.PORT = "8000";
  if (isPlaceholder(values.PM2_MANAGER_PUBLIC_PORT)) updates.PM2_MANAGER_PUBLIC_PORT = String(values.PORT || "8000");
  if (isPlaceholder(values.PROJECTS_ROOT) || values.PROJECTS_ROOT === "/user/pm2-manager/apps/") {
    updates.PROJECTS_ROOT = path.join(appDir, "apps");
  }

  const mergedValues = { ...values, ...updates };
  if (isPlaceholder(mergedValues.APP_PUBLIC_URL)) {
    updates.APP_PUBLIC_URL = buildDefaultPublicUrl(mergedValues);
  }
  if (isPlaceholder(mergedValues.CORS_ALLOWED_ORIGINS)) {
    updates.CORS_ALLOWED_ORIGINS = mergedValues.APP_PUBLIC_URL || buildDefaultPublicUrl(mergedValues);
  }

  const nextContent = upsertEnv(content, updates, removals);
  if (!fs.existsSync(envPath) || nextContent !== content) {
    fs.writeFileSync(envPath, nextContent, { mode: 0o600 });
  }
  try {
    fs.chmodSync(envPath, 0o600);
  } catch (_error) {
    // Best effort. Some filesystems do not support chmod.
  }

  const finalValues = parseEnv(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(finalValues)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  if (options.print) {
    console.log(`Runtime env ready: ${envPath}`);
    if (generated.PM2_USER || generated.PM2_PASS) {
      console.log("Generated login credentials");
      if (generated.PM2_USER) console.log(`- Username: ${generated.PM2_USER}`);
      if (generated.PM2_PASS) console.log(`- Password: ${generated.PM2_PASS}`);
      console.log("Save these credentials now. The password is not printed again.");
    }
    if (generated.JWT_SECRET) console.log("- JWT_SECRET: generated and stored in .env");
    if (generated.METRICS_TOKEN) console.log("- METRICS_TOKEN: generated and stored in .env");
  }

  return { envPath, values: finalValues, generated };
}

if (require.main === module) {
  try {
    ensureRuntimeEnv({ print: true });
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  ensureRuntimeEnv,
  parseEnv,
  upsertEnv
};

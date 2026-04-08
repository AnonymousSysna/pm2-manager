// @ts-nocheck
const path = require("path");

const PROCESS_NAME_PATTERN = /^[A-Za-z0-9:_-]{1,100}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_ARG_CHARS = /^[A-Za-z0-9_./:=,@+\-\s]*$/;
const RESERVED_PROCESS_NAMES = new Set(["catalog", "interpreters"]);
const GIT_CLONE_SSH_PATTERN = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;
const GIT_CLONE_PROTOCOLS = new Set(["http:", "https:", "ssh:", "git:", "file:"]);

function sanitizeProcessName(name, field = "name") {
  const value = String(name || "").trim();
  if (!PROCESS_NAME_PATTERN.test(value)) {
    throw new Error(`${field} must match ${PROCESS_NAME_PATTERN}`);
  }
  if (RESERVED_PROCESS_NAMES.has(value.toLowerCase())) {
    throw new Error(`${field} contains reserved value: ${value}`);
  }
  return value;
}

function sanitizeScriptPath(script) {
  const value = String(script || "").trim();
  if (!value) {
    throw new Error("Script path is required");
  }

  const normalized = path.normalize(value);
  const segments = normalized.split(path.sep).filter(Boolean);
  if (segments.includes("..")) {
    throw new Error("Script path cannot contain traversal segments");
  }

  return normalized;
}

function sanitizeEnvObject(env) {
  if (!env) {
    return {};
  }

  if (typeof env !== "object" || Array.isArray(env)) {
    throw new Error("env must be an object");
  }

  const cleaned = {};
  for (const [rawKey, rawValue] of Object.entries(env)) {
    const key = String(rawKey || "").trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment variable name: ${rawKey}`);
    }
    cleaned[key] = String(rawValue ?? "");
  }
  return cleaned;
}

function resolveSafePath(inputPath, basePath, fieldName = "path") {
  const raw = String(inputPath || "").trim();
  if (!raw) {
    throw new Error(`${fieldName} is required`);
  }

  const sanitized = sanitizeScriptPath(raw);
  const resolved = path.isAbsolute(sanitized)
    ? path.resolve(sanitized)
    : path.resolve(basePath, sanitized);
  const baseResolved = path.resolve(basePath);
  const relative = path.relative(baseResolved, resolved);

  const isInsideBase =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (!isInsideBase) {
    throw new Error(`${fieldName} must be inside allowed base path`);
  }

  return resolved;
}

function sanitizeOptionalString(value, fieldName, maxLength = 256) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const str = String(value).trim();
  if (!str) {
    return undefined;
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} exceeds max length ${maxLength}`);
  }
  if (!SAFE_ARG_CHARS.test(str)) {
    throw new Error(`${fieldName} contains invalid characters`);
  }
  return str;
}

function sanitizeNodeArgs(nodeArgs) {
  if (nodeArgs === undefined || nodeArgs === null || nodeArgs === "") {
    return undefined;
  }
  if (Array.isArray(nodeArgs)) {
    return nodeArgs.map((arg) => sanitizeOptionalString(arg, "node_args", 128)).filter(Boolean);
  }
  return sanitizeOptionalString(nodeArgs, "node_args", 512);
}

function sanitizeMaxMemoryRestart(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const str = String(value).trim();
  if (!/^\d+(?:\.\d+)?(?:K|M|G)$/i.test(str)) {
    throw new Error("max_memory_restart must match e.g. 256M, 1G");
  }
  return str.toUpperCase();
}

function sanitizeInterpreter(value) {
  return sanitizeOptionalString(value, "interpreter", 128);
}

function sanitizeCronExpression(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const str = String(value).trim();
  if (!str) {
    return undefined;
  }
  if (str.length > 128) {
    throw new Error("cron_restart exceeds max length 128");
  }
  if (!/^[A-Za-z0-9_*,\/\-?\s]+$/.test(str)) {
    throw new Error("cron_restart contains invalid characters");
  }
  return str;
}

function sanitizeGitCloneUrl(value, fieldName = "git_clone_url") {
  const str = String(value || "").trim();
  if (!str) {
    throw new Error(`${fieldName} is required`);
  }
  if (str.length > 2048) {
    throw new Error(`${fieldName} exceeds max length 2048`);
  }
  if (/\s/.test(str)) {
    throw new Error(`${fieldName} cannot contain whitespace`);
  }

  if (GIT_CLONE_SSH_PATTERN.test(str)) {
    const remotePath = str.split(":").slice(1).join(":");
    if (!remotePath || !remotePath.includes("/")) {
      throw new Error(`${fieldName} must be a valid git clone URL`);
    }
    return str;
  }

  let parsed;
  try {
    parsed = new URL(str);
  } catch (_error) {
    throw new Error(`${fieldName} must be a valid git clone URL`);
  }

  if (!GIT_CLONE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${fieldName} must use http, https, ssh, git, or file protocol`);
  }
  if (parsed.protocol !== "file:" && !parsed.hostname) {
    throw new Error(`${fieldName} must include a hostname`);
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error(`${fieldName} must include a repository path`);
  }

  return str;
}

module.exports = {
  PROCESS_NAME_PATTERN,
  ENV_KEY_PATTERN,
  sanitizeProcessName,
  sanitizeScriptPath,
  sanitizeEnvObject,
  resolveSafePath,
  sanitizeOptionalString,
  sanitizeNodeArgs,
  sanitizeMaxMemoryRestart,
  sanitizeInterpreter,
  sanitizeCronExpression,
  sanitizeGitCloneUrl
};


const fs = require("fs");
const path = require("path");
const { normalizeOrigin } = require("./urlSafety");

const PLACEHOLDER_PATTERNS = [
  /^replace_/i,
  /replace[_-]?with/i,
  /^changeme$/i,
  /^change[-_]?this/i,
  /^your[-_]?secret/i,
  /^dev[-_]?secret/i,
  /^admin$/i
];
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;
const MIN_SECRET_LENGTH = 32;

function hasValue(name) {
  return String(process.env[name] || "").trim().length > 0;
}

function readEnv(name) {
  return String(process.env[name] || "").trim();
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text));
}

function assertPresent(name, issues) {
  const value = readEnv(name);
  if (!value) {
    issues.push(`${name} is required`);
    return "";
  }
  if (isPlaceholder(value)) {
    issues.push(`${name} still looks like a placeholder`);
  }
  return value;
}

function assertStrongSecret(name, issues, minLength = MIN_SECRET_LENGTH) {
  const value = assertPresent(name, issues);
  if (value && value.length < minLength) {
    issues.push(`${name} must be at least ${minLength} characters`);
  }
  return value;
}

function validateAllowedOrigins(issues, warnings) {
  const origins = readEnv("CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const origin of origins) {
    if (!normalizeOrigin(origin)) {
      issues.push(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
  }

  if (process.env.NODE_ENV === "production" && origins.length === 0) {
    warnings.push("CORS_ALLOWED_ORIGINS is empty; browser API access will only work from the same origin.");
  }
}

function validateCookieSettings(issues, warnings) {
  const sameSite = readEnv("COOKIE_SAME_SITE").toLowerCase();
  if (sameSite && !["lax", "strict", "none"].includes(sameSite)) {
    issues.push("COOKIE_SAME_SITE must be lax, strict, or none");
  }

  const secure = readEnv("COOKIE_SECURE").toLowerCase();
  if (sameSite === "none" && !["1", "true", "yes", "on"].includes(secure)) {
    issues.push("COOKIE_SECURE must be enabled when COOKIE_SAME_SITE=none");
  }

  if (process.env.NODE_ENV === "production" && !["1", "true", "yes", "on"].includes(secure)) {
    warnings.push("COOKIE_SECURE is not forced; use HTTPS or set COOKIE_SECURE=1 behind a TLS proxy.");
  }
}

function validateRuntimeFiles(warnings) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const indexFile = path.resolve(__dirname, "../../client/dist/index.html");
  if (!fs.existsSync(indexFile)) {
    warnings.push("client/dist/index.html is missing; run npm run build before starting production.");
  }
}

function getEnvironmentReport() {
  const issues = [];
  const warnings = [];

  assertPresent("PM2_USER", issues);

  const passHash = readEnv("PM2_PASS_HASH");
  const plainPass = readEnv("PM2_PASS");
  if (!passHash && !plainPass) {
    issues.push("PM2_PASS_HASH is required; PM2_PASS is only acceptable for local development.");
  }
  if (passHash) {
    if (isPlaceholder(passHash)) {
      issues.push("PM2_PASS_HASH still looks like a placeholder");
    }
    if (!BCRYPT_HASH_PATTERN.test(passHash)) {
      issues.push("PM2_PASS_HASH must be a bcrypt hash");
    }
  }
  if (plainPass) {
    if (process.env.NODE_ENV === "production") {
      issues.push("PM2_PASS must not be used in production; use PM2_PASS_HASH instead.");
    } else if (plainPass.length < 12 || isPlaceholder(plainPass)) {
      issues.push("PM2_PASS must be at least 12 characters when used for local development.");
    }
  }

  assertStrongSecret("JWT_SECRET", issues);
  assertStrongSecret("METRICS_TOKEN", issues);
  validateAllowedOrigins(issues, warnings);
  validateCookieSettings(issues, warnings);
  validateRuntimeFiles(warnings);

  return {
    ok: issues.length === 0,
    issues,
    warnings,
    production: process.env.NODE_ENV === "production"
  };
}

function assertEnvironmentReady() {
  const report = getEnvironmentReport();
  if (!report.ok) {
    const detail = report.issues.map((issue) => `- ${issue}`).join("\n");
    throw new Error(`Production configuration is not safe:\n${detail}`);
  }
  return report;
}

module.exports = {
  assertEnvironmentReady,
  getEnvironmentReport,
  hasValue,
  isPlaceholder,
  readEnv
};

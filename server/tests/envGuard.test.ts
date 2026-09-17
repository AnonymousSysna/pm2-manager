const test = require("node:test");
const assert = require("node:assert/strict");
const { getEnvironmentReport } = require("../utils/envGuard");

const KEYS = [
  "NODE_ENV",
  "PM2_USER",
  "PM2_PASS",
  "PM2_PASS_HASH",
  "JWT_SECRET",
  "METRICS_TOKEN",
  "CORS_ALLOWED_ORIGINS",
  "COOKIE_SECURE",
  "COOKIE_SAME_SITE"
];

function withEnv(values, fn) {
  const old = {};
  for (const key of KEYS) {
    old[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, values);
  try {
    return fn();
  } finally {
    for (const key of KEYS) {
      if (old[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = old[key];
      }
    }
  }
}

test("environment report rejects placeholders and short secrets", () => {
  withEnv({
    NODE_ENV: "production",
    PM2_USER: "replace_with_admin_username",
    PM2_PASS_HASH: "$2a$10$replace_with_bcrypt_hash",
    JWT_SECRET: "short",
    METRICS_TOKEN: "short"
  }, () => {
    const report = getEnvironmentReport();
    assert.equal(report.ok, false);
    assert.ok(report.issues.some((issue) => issue.includes("PM2_USER")));
    assert.ok(report.issues.some((issue) => issue.includes("JWT_SECRET")));
    assert.ok(report.issues.some((issue) => issue.includes("METRICS_TOKEN")));
  });
});

test("environment report accepts production hash and long secrets", () => {
  withEnv({
    NODE_ENV: "production",
    PM2_USER: "operator",
    PM2_PASS_HASH: "$2b$10$123456789012345678901u1234567890123456789012345678901",
    JWT_SECRET: "abcdefghijklmnopqrstuvwxyz1234567890",
    METRICS_TOKEN: "1234567890abcdefghijklmnopqrstuvwxyz",
    CORS_ALLOWED_ORIGINS: "https://pm2.example.com",
    COOKIE_SECURE: "1",
    COOKIE_SAME_SITE: "lax"
  }, () => {
    const report = getEnvironmentReport();
    assert.equal(report.ok, true);
  });
});

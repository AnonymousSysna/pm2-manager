const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  sanitizeProcessName,
  sanitizeEnvObject,
  resolveSafePath,
  sanitizeGitCloneUrl
} = require("../utils/validation");

test("sanitizeProcessName allows safe names", () => {
  assert.equal(sanitizeProcessName("api_server-01"), "api_server-01");
});

test("sanitizeProcessName rejects unsafe names", () => {
  assert.throws(() => sanitizeProcessName("../evil"), /must match/);
});

test("sanitizeEnvObject validates keys", () => {
  assert.deepEqual(
    sanitizeEnvObject({ PORT: 3000, NODE_ENV: "production" }),
    { PORT: "3000", NODE_ENV: "production" }
  );
  assert.throws(() => sanitizeEnvObject({ "A-B": "bad" }), /Invalid environment variable name/);
});

test("resolveSafePath blocks traversal outside base", () => {
  const base = path.resolve("D:/tmp/safe-base");
  assert.throws(
    () => resolveSafePath("../../etc/passwd", base, "project_path"),
    /(inside allowed base path|traversal segments)/
  );
});

test("sanitizeGitCloneUrl accepts common git remote formats", () => {
  assert.equal(
    sanitizeGitCloneUrl("https://github.com/acme/sample-app.git"),
    "https://github.com/acme/sample-app.git"
  );
  assert.equal(
    sanitizeGitCloneUrl("git@github.com:acme/sample-app.git"),
    "git@github.com:acme/sample-app.git"
  );
});

test("sanitizeGitCloneUrl rejects malformed clone URLs", () => {
  assert.throws(() => sanitizeGitCloneUrl("dasdas"), /must be a valid git clone URL/);
  assert.throws(() => sanitizeGitCloneUrl("https://github.com"), /must include a repository path/);
  assert.throws(() => sanitizeGitCloneUrl("https://git hub.com/acme/repo.git"), /cannot contain whitespace/);
});


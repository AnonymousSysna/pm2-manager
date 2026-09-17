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

const fs = require("fs");
const {
  sanitizeMaxMemoryRestart,
  sanitizeCronExpression
} = require("../utils/validation");

const validationCases = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "validationCases.json"), "utf8")
);

// Applies a fixture case to the matching server sanitizer and reports acceptance.
function serverAccepts(field, value) {
  try {
    if (field === "processName") {
      sanitizeProcessName(value);
    } else if (field === "gitCloneUrl") {
      sanitizeGitCloneUrl(value);
    } else if (field === "envKey") {
      sanitizeEnvObject({ [value]: "1" });
    } else if (field === "maxMemoryRestart") {
      sanitizeMaxMemoryRestart(value);
    } else if (field === "cron") {
      sanitizeCronExpression(value);
    } else {
      throw new Error(`unknown validation field: ${field}`);
    }
    return true;
  } catch (_error) {
    return false;
  }
}

// The same table drives client/src/lib/validation.test.ts, so a rule that only one
// side knows about fails a build.
for (const [field, list] of Object.entries(validationCases)) {
  if (field.startsWith("_") || !Array.isArray(list)) {
    continue;
  }

  for (const item of list) {
    const label = String(item.value).slice(0, 32).replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    test(`validation cases: ${field} "${label}" is ${item.valid ? "accepted" : "rejected"}`, () => {
      assert.equal(serverAccepts(field, item.value), item.valid, item.note || field);
    });
  }
}

test("sanitizeCronExpression normalizes spacing and rejects control whitespace", () => {
  assert.equal(sanitizeCronExpression("0   3 * * *"), "0 3 * * *");
  assert.equal(sanitizeCronExpression("  0 3 * * *  "), "0 3 * * *");
  assert.equal(sanitizeCronExpression(null), undefined);
  assert.throws(() => sanitizeCronExpression("0 3 * * *\n0 4 * * *"), /single spaces/);
  assert.throws(() => sanitizeCronExpression("0 3 * * * 0 5"), /single spaces/);
});

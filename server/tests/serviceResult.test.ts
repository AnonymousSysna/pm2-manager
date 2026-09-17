const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

const {
  ServiceError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
  failure,
  failureFrom,
  invalid,
  success,
  resultStatus,
  normalizeStatus,
  errorStatus
} = require("../utils/serviceResult");
const { sanitizeProcessName } = require("../utils/validation");
const processesRouter = require("../routes/processes");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Unit: the typed result protocol
// ---------------------------------------------------------------------------

test("typed errors carry their HTTP status and expose the message", () => {
  assert.equal(new ValidationError("bad name").status, 400);
  assert.equal(new ConflictError("already exists").status, 409);
  assert.equal(new ForbiddenError("restricted").status, 403);
  assert.equal(new NotFoundError("missing").status, 404);
  assert.equal(new UnavailableError("pm2 down").status, 503);

  for (const error of [new ValidationError("x"), new ConflictError("x"), new ForbiddenError("x")]) {
    assert.equal(error.expose, true, `${error.name} should expose its message`);
  }

  // A 5xx ServiceError hides its message by default; the handler decides to leak it.
  assert.equal(new ServiceError("boom").status, 500);
  assert.equal(new ServiceError("boom").expose, false);
  assert.equal(new ServiceError("boom", 500, null, true).expose, true);
});

test("failureFrom keeps a typed status and falls back for untagged errors", () => {
  assert.equal(failureFrom(new ValidationError("name must match")).status, 400);
  assert.equal(failureFrom(new ValidationError("name must match")).error, "name must match");
  assert.equal(failureFrom(new ConflictError("port in use")).status, 409);
  assert.equal(failureFrom(new NotFoundError("no such process")).status, 404);

  const plain = failureFrom(new Error("read ECONNRESET"));
  assert.equal(plain.status, 500);
  assert.equal(plain.error, "read ECONNRESET");

  // Callers can choose the fallback when the throw site is known to be client-caused.
  assert.equal(failureFrom(new Error("Invalid cron_restart"), 400).status, 400);
  assert.equal(failureFrom(undefined, 400, "Invalid options").error, "Invalid options");
});

test("failure envelopes stay backward compatible and add status/code", () => {
  const result = invalid("name must match", "validation_error");
  assert.equal(result.success, false);
  assert.equal(result.data, null);
  assert.equal(result.error, "name must match");
  assert.equal(result.status, 400);
  assert.equal(result.code, "validation_error");

  // Success payloads must not grow new fields: the client only reads data/error.
  assert.deepEqual(success({ name: "api" }), {
    success: true,
    data: { name: "api" },
    error: null
  });
  assert.deepEqual(Object.keys(success([])).sort(), ["data", "error", "success"]);
});

test("normalizeStatus rejects values that are not HTTP errors", () => {
  assert.equal(normalizeStatus(400), 400);
  assert.equal(normalizeStatus(599), 599);
  assert.equal(normalizeStatus(200), 500);
  assert.equal(normalizeStatus(999), 500);
  assert.equal(normalizeStatus("403"), 403);
  assert.equal(normalizeStatus(undefined), 500);
  assert.equal(normalizeStatus(200, 400), 400);
  assert.equal(errorStatus({ statusCode: 404 }), 404);
  assert.equal(errorStatus(new Error("no status")), 500);
});

test("resultStatus turns a service result into an HTTP status", () => {
  assert.equal(resultStatus(success([])), 200);
  assert.equal(resultStatus(success([]), 201), 201);
  assert.equal(resultStatus(failure("bad input", 400)), 400);
  assert.equal(resultStatus(failure("gone", 404)), 404);
  // Legacy results without a status still resolve to a server error.
  assert.equal(resultStatus({ success: false, data: null, error: "old shape" }), 500);
  assert.equal(resultStatus({ success: true, data: null, error: null }), 200);
  assert.equal(resultStatus(undefined), 200);
});

test("validation sanitizers throw typed 400s", () => {
  assert.throws(() => sanitizeProcessName("../evil"), (error) => {
    assert.equal(error.name, "ValidationError");
    assert.equal(error.status, 400);
    assert.equal(error.expose, true);
    return true;
  });
});

// ---------------------------------------------------------------------------
// Integration: the real router reports statuses from service results
// ---------------------------------------------------------------------------

async function startRouter() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  app.use("/api/v1/processes", processesRouter);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: jwt.sign(
      { username: "admin", tokenType: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "5m" }
    )
  };
}

test("process routes map service results to status codes without reading message text", async () => {
  const tempDir = makeTempDir("pm2-manager-service-result-");
  const originalEnv = {
    JWT_SECRET: process.env.JWT_SECRET,
    AUDIT_TRAIL_PATH: process.env.AUDIT_TRAIL_PATH,
    RESTART_HISTORY_PATH: process.env.RESTART_HISTORY_PATH,
    NOTIFICATION_STORE_PATH: process.env.NOTIFICATION_STORE_PATH
  };
  process.env.JWT_SECRET = "test-jwt-secret";
  process.env.AUDIT_TRAIL_PATH = path.join(tempDir, "audit.jsonl");
  process.env.RESTART_HISTORY_PATH = path.join(tempDir, "restarts.jsonl");
  process.env.NOTIFICATION_STORE_PATH = path.join(tempDir, "notifications.jsonl");

  const { server, baseUrl, token } = await startRouter();
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  };

  try {
    // 400 from the path validator middleware.
    const badName = await fetch(`${baseUrl}/api/v1/processes/..%2Fetc`, { headers });
    assert.equal(badName.status, 400);
    const badNameBody = await badName.json();
    assert.equal(badNameBody.success, false);
    assert.match(badNameBody.error, /must match/);

    // 400 from a controller validation result (guard runs before any PM2 call).
    const bulk = await fetch(`${baseUrl}/api/v1/processes/bulk-action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "explode", names: ["api-server"] })
    });
    assert.equal(bulk.status, 400, "unsupported bulk action must be a client error");
    const bulkBody = await bulk.json();
    assert.equal(bulkBody.status, 400);
    assert.equal(bulkBody.code, "unsupported_bulk_action");

    // 400 for a malformed names array.
    const emptyNames = await fetch(`${baseUrl}/api/v1/processes/bulk-action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "restart", names: [] })
    });
    assert.equal(emptyNames.status, 400);
    assert.equal((await emptyNames.json()).code, "invalid_names");

    // 409 from the dashboard self-protection guard.
    const selfStop = await fetch(`${baseUrl}/api/v1/processes/pm2-dashboard/stop`, {
      method: "POST",
      headers
    });
    assert.equal(selfStop.status, 409, "stopping the dashboard itself must conflict");
    const selfStopBody = await selfStop.json();
    assert.equal(selfStopBody.code, "self_process_protected");
    assert.match(selfStopBody.error, /cannot stop itself/i);

    // 400 for the duplicate-name validation guard (same name as the source).
    const duplicate = await fetch(`${baseUrl}/api/v1/processes/api-server/duplicate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "api-server" })
    });
    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).code, "duplicate_name_conflict");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(process.env, originalEnv);
  }
});

test("process routes no longer infer status codes from error text", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "processes.ts"), "utf8");
  assert.doesNotMatch(source, /\.test\(result\.error/, "route must not regex-match failure messages");
  assert.doesNotMatch(source, /\? 400\s*\n\s*:\s*500/, "route must not branch on 400 vs 500 by hand");
  assert.match(source, /resultStatus\(result\)/);
});

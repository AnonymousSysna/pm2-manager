const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const express = require("express");

// verifyToken short-circuits with 503 when auth is unconfigured; give it a secret so the
// GET route exercises the real "no token" path.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-please-ignore-0123456789abcdef";

const clientErrorRouter = require("../routes/clientErrors");
const {
  buildFingerprint,
  createClientErrorStore,
  sanitizeClientErrorReport
} = require("../utils/clientErrorReport");

const store = clientErrorRouter.__store;

function startServer(): Promise<any> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((req, _res, next) => {
    req.ip = "127.0.0.1";
    next();
  });
  app.use("/api/v1/client-errors", clientErrorRouter);
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test.beforeEach(() => {
  store.clear();
});

test("sanitizeClientErrorReport keeps the useful fields and trims noise", () => {
  const result = sanitizeClientErrorReport({
    kind: "react",
    message: "Cannot read properties of undefined (reading 'name')",
    name: "TypeError",
    stack: "TypeError: boom\n  at a\n  at b",
    componentStack: "\n  in ProcessCard\n  in Dashboard\n",
    source: "ProcessCard",
    url: "https://pm2.example.com/dashboard?token=supersecret&process=api",
    userAgent: "Mozilla/5.0",
    route: "/dashboard",
    release: "1.4.0",
    sessionId: "abc-123!!",
    extra: { attempt: 2 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.kind, "react");
  assert.equal(result.value.name, "TypeError");
  assert.equal(result.value.source, "ProcessCard");
  assert.equal(result.value.sessionId, "abc-123");
  assert.equal(result.value.route, "/dashboard");
  assert.match(result.value.componentStack, /in ProcessCard/);
  assert.equal(result.value.extra.attempt, 2);
  // Query strings must never be forwarded verbatim.
  assert.equal(result.value.url.includes("supersecret"), false);
});

test("sanitizeClientErrorReport redacts secret-looking values in messages", () => {
  const result = sanitizeClientErrorReport({
    message: "Request failed JWT_SECRET=abcdefghijklmnopqrstuvwxyz123456"
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.message.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
});

test("sanitizeClientErrorReport rejects malformed payloads", () => {
  assert.equal(sanitizeClientErrorReport(null).ok, false);
  assert.equal(sanitizeClientErrorReport([]).ok, false);
  assert.equal(sanitizeClientErrorReport({ message: "   " }).ok, false);
  assert.equal(sanitizeClientErrorReport({ message: 42 }).ok, true);
});

test("sanitizeClientErrorReport caps oversized stacks", () => {
  const result = sanitizeClientErrorReport({
    message: "big",
    stack: Array.from({ length: 200 }, (_, index) => `  at frame${index}`).join("\n")
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.stack.split("\n").length, 40);
});

test("buildFingerprint groups repeats of the same crash", () => {
  const first = sanitizeClientErrorReport({
    message: "boom",
    source: "Dashboard",
    stack: "Error: boom\n  at Dashboard (app.js:1:2)\n  at render (react.js:3:4)"
  }).value;
  const second = sanitizeClientErrorReport({
    message: "boom",
    source: "Dashboard",
    stack: "Error: boom\n  at Dashboard (app.js:1:2)\n  at render (react.js:3:4)",
    userAgent: "different-agent"
  }).value;

  assert.equal(buildFingerprint(first), buildFingerprint(second));
});

test("client error store caps entries and counts occurrences", () => {
  const smallStore = createClientErrorStore({ max: 2 });
  smallStore.record({ kind: "error", message: "one" });
  smallStore.record({ kind: "error", message: "one" });
  smallStore.record({ kind: "error", message: "two" });
  smallStore.record({ kind: "error", message: "three" });

  assert.equal(smallStore.size(), 2);
  const messages = smallStore.list().map((entry) => entry.report.message).sort(); 
  assert.deepEqual(messages, ["three", "two"]);
});

test("POST /client-errors accepts valid reports without authentication", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/v1/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Unhandled rejection: network down",
        kind: "unhandledrejection",
        route: "/dashboard",
        url: "https://pm2.example.com/dashboard"
      })
    });

    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(typeof payload.data.fingerprint, "string");
    assert.equal(payload.data.occurrences, 1);

    const repeat = await fetch(`${baseUrl}/api/v1/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Unhandled rejection: network down",
        kind: "unhandledrejection",
        route: "/dashboard"
      })
    });
    const repeatPayload = await repeat.json();
    assert.equal(repeatPayload.data.occurrences, 2);
    assert.equal(repeatPayload.data.fingerprint, payload.data.fingerprint);
  } finally {
    server.close();
  }
});

test("POST /client-errors rejects an empty body", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/v1/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.match(payload.error, /message is required/);
  } finally {
    server.close();
  }
});

test("GET /client-errors requires authentication", async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/v1/client-errors`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

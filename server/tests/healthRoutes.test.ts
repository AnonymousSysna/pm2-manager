const test = require("node:test");
const assert = require("node:assert/strict");

const { registerHealthRoutes } = require("../routes/health");
const { HEALTHCHECK_TIMEOUT_MS } = require("../utils/healthProbe");

function createApp() {
  const routes = new Map();
  return {
    routes,
    get(path, handler) {
      routes.set(path, handler);
    }
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function call(app, path) {
  const handler = app.routes.get(path);
  assert.ok(handler, `route ${path} is registered`);
  const res = createResponse();
  await handler({ method: "GET", path, headers: {}, socket: { remoteAddress: "127.0.0.1" } }, res);
  return res;
}

function mount(deps = {}) {
  const app = createApp();
  registerHealthRoutes(app, {
    port: 8000,
    getEnvironmentReport: () => ({ ok: true }),
    getPM2QueueState: () => ({ pending: 0 }),
    ...deps
  });
  return app;
}

const okProbe = async () => ({ ok: true, code: 0, timedOut: false, output: "" });

test("a reachable pm2 answers 200 on both endpoints", async () => {
  const app = mount({ probePm2Health: okProbe });

  const ready = await call(app, "/ready");
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.payload.status, "ready");
  assert.equal(ready.payload.pm2Connected, true);
  assert.deepEqual(ready.payload.pm2Queue, { pending: 0 });
  assert.equal(typeof ready.payload.uptime, "number");
  assert.ok(ready.payload.timestamp > 0);

  const health = await call(app, "/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.payload.status, "ok");
  assert.equal(health.payload.error, null);
  assert.equal(health.payload.port, 8000);
});

test("an unhealthy pm2 answers 503 and explains why", async () => {
  const timedOut = mount({
    probePm2Health: async () => ({ ok: false, code: null, timedOut: true, output: "" })
  });
  const health = await call(timedOut, "/health");
  assert.equal(health.statusCode, 503);
  assert.equal(health.payload.status, "degraded");
  assert.equal(health.payload.pm2Connected, false);
  assert.equal(health.payload.error, `PM2 health probe timed out after ${HEALTHCHECK_TIMEOUT_MS}ms`);

  const failed = mount({
    probePm2Health: async () => ({ ok: false, code: 1, timedOut: false, output: "PM2 daemon not found" })
  });
  const failedHealth = await call(failed, "/health");
  assert.equal(failedHealth.statusCode, 503);
  assert.equal(failedHealth.payload.error, "PM2 daemon not found");

  const ready = await call(timedOut, "/ready");
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.payload.status, "not_ready");
});

test("a probe that throws still answers instead of leaving the request open", async () => {
  // This is the regression: a rejected promise in an async Express handler
  // produces no response at all, so a broken probe used to hang the request
  // forever rather than report the dashboard as unready.
  const app = mount({
    probePm2Health: async () => {
      throw new Error("spawn EINVAL");
    }
  });

  const ready = await call(app, "/ready");
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.payload.status, "not_ready");
  assert.equal(ready.payload.pm2Connected, false);

  const health = await call(app, "/health");
  assert.equal(health.statusCode, 503);
  assert.match(health.payload.error, /spawn EINVAL/);
});

test("a valid environment is required for readiness even when pm2 is up", async () => {
  const app = mount({
    probePm2Health: okProbe,
    getEnvironmentReport: () => ({ ok: false })
  });

  const ready = await call(app, "/ready");
  assert.equal(ready.statusCode, 503);
  assert.equal(ready.payload.status, "not_ready");
  assert.equal(ready.payload.pm2Connected, true, "the probe result is still reported");

  const health = await call(app, "/health");
  assert.equal(health.statusCode, 200, "/health reports reachability, not configuration");
});

test("three polls inside the cache window cost one probe", async () => {
  let calls = 0;
  const app = mount({
    probePm2Health: async () => {
      calls += 1;
      return { ok: true, code: 0, timedOut: false, output: "" };
    },
    probeCacheOptions: { ttlMs: 60000 }
  });

  await call(app, "/ready");
  await call(app, "/health");
  await call(app, "/ready");

  assert.equal(calls, 1, "a poller must not pay for an npm startup per request");
});

test("a result older than the window is probed again", async () => {
  let calls = 0;
  let clock = 5000;
  const app = mount({
    probePm2Health: async () => {
      calls += 1;
      return { ok: true, code: 0, timedOut: false, output: "" };
    },
    probeCacheOptions: { ttlMs: 1000, now: () => clock }
  });

  const ready = await call(app, "/ready");
  assert.equal(ready.statusCode, 200);
  assert.equal(calls, 1);

  clock += 1001;
  const health = await call(app, "/health");
  assert.equal(health.statusCode, 200);
  assert.equal(calls, 2, "a stale answer is refreshed rather than served forever");
});

test("a cached probe failure keeps both endpoints answering", async () => {
  let calls = 0;
  const app = mount({
    probePm2Health: async () => {
      calls += 1;
      throw new Error("pm2 binary missing");
    },
    probeCacheOptions: { ttlMs: 60000 }
  });

  const ready = await call(app, "/ready");
  assert.equal(ready.statusCode, 503);
  const health = await call(app, "/health");
  assert.equal(health.statusCode, 503);
  assert.match(health.payload.error, /pm2 binary missing/);
  assert.equal(calls, 1, "the failure is replayed from the cache");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../middleware/rateLimit");

function createReq() {
  return {
    ip: "127.0.0.1",
    baseUrl: "/api/v1/processes",
    path: "/create",
    method: "POST"
  };
}

function createRes() {
  return {
    headers: {},
    code: 200,
    body: null,
    set(name, value) {
      this.headers[name] = value;
    },
    status(value) {
      this.code = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

test("createRateLimiter allows requests within threshold", () => {
  const limiter = createRateLimiter({ windowMs: 10_000, max: 2, message: "Too many" });
  const req = createReq();
  const res = createRes();
  let calls = 0;
  limiter(req, res, () => {
    calls += 1;
  });
  limiter(req, res, () => {
    calls += 1;
  });
  assert.equal(calls, 2);
  assert.equal(res.code, 200);
});

test("createRateLimiter returns 429 when threshold exceeded", () => {
  const limiter = createRateLimiter({ windowMs: 10_000, max: 1, message: "Too many" });
  const req = createReq();
  const res = createRes();
  let calls = 0;
  limiter(req, res, () => {
    calls += 1;
  });
  limiter(req, res, () => {
    calls += 1;
  });
  assert.equal(calls, 1);
  assert.equal(res.code, 429);
  assert.equal(res.body.error, "Too many");
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
});

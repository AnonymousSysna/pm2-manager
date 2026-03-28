// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCookieHeader } = require("../utils/cookies");

test("parseCookieHeader parses key-value pairs", () => {
  const parsed = parseCookieHeader("a=1; b=hello%20world");
  assert.equal(parsed.a, "1");
  assert.equal(parsed.b, "hello world");
});

test("parseCookieHeader tolerates malformed escape sequences", () => {
  const parsed = parseCookieHeader("token=%E0%A4%A");
  assert.equal(parsed.token, "%E0%A4%A");
});


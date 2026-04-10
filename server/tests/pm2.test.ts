// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const { isStartupPersistenceVerified } = require("../routes/pm2");

test("startup persistence verification rejects unsupported platforms even with dump.pm2 present", () => {
  const verified = isStartupPersistenceVerified(
    { supported: false, enabled: null, manager: null, service: null, output: "" },
    true
  );

  assert.equal(verified, false);
});

test("startup persistence verification requires both dump.pm2 and enabled startup detection", () => {
  assert.equal(
    isStartupPersistenceVerified(
      { supported: true, enabled: true, manager: "systemd", service: "pm2-user", output: "enabled" },
      true
    ),
    true
  );

  assert.equal(
    isStartupPersistenceVerified(
      { supported: true, enabled: false, manager: "systemd", service: "pm2-user", output: "" },
      true
    ),
    false
  );

  assert.equal(
    isStartupPersistenceVerified(
      { supported: true, enabled: true, manager: "systemd", service: "pm2-user", output: "enabled" },
      false
    ),
    false
  );
});

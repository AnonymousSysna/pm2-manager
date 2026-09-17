const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getPm2FeatureCatalog,
  buildPm2FeatureInvocation
} = require("../utils/pm2FeatureCatalog");

test("PM2 feature catalog covers the major PM2 groups", () => {
  const catalog = getPm2FeatureCatalog();
  const categories = new Set(catalog.categories.map((item) => item.id));

  for (const required of ["observe", "lifecycle", "logs", "persistence", "ecosystem", "deploy", "modules"]) {
    assert.equal(categories.has(required), true, `missing ${required}`);
  }

  assert.ok(catalog.features.length >= 30);
});

test("PM2 feature invocation builds safe command args", () => {
  const invocation = buildPm2FeatureInvocation("restart-update-env", { target: "api" });
  assert.deepEqual(invocation.args, ["restart", "api", "--update-env"]);
  assert.equal(invocation.risk, "write");
});

test("PM2 feature invocation blocks shell-like target injection", () => {
  assert.throws(
    () => buildPm2FeatureInvocation("restart", { target: "api; rm -rf /" }),
    /target contains invalid characters/
  );
});

test("critical PM2 feature commands are marked critical", () => {
  const invocation = buildPm2FeatureInvocation("kill-daemon", {});
  assert.equal(invocation.risk, "critical");
  assert.deepEqual(invocation.args, ["kill"]);
});

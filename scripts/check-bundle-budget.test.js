const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");

const {
  collectEagerAssets,
  expandStaticImports,
  evaluateBudget,
  gzipSize,
  EAGER_GZIP_BUDGET_BYTES
} = require("./check-bundle-budget");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

runTest("collectEagerAssets reads scripts and modulepreload links, dedupes, ignores non-JS", () => {
  const html = [
    '<!doctype html><html><head>',
    '<link rel="modulepreload" crossorigin href="/assets/vendor-Ab12.js">',
    '<link rel="stylesheet" crossorigin href="/assets/index-Cd34.css">',
    '<script type="module" crossorigin src="/assets/index-Cd34.js"></script>',
    '</head><body><div id="root"></div>',
    '<script src="/assets/vendor-Ab12.js"></script>',
    '</body></html>'
  ].join("\n");

  assert.deepEqual(collectEagerAssets(html), ["index-Cd34.js", "vendor-Ab12.js"]);
  assert.deepEqual(collectEagerAssets("<html></html>"), []);
});

runTest("gzipSize compresses repetition and grows with entropy", () => {
  const repetitive = Buffer.from("a".repeat(200 * 1024));
  const random = Buffer.from(randomBytes(200 * 1024));
  assert.ok(gzipSize(repetitive) < 1024, "repeated bytes should compress to well under 1 kB");
  assert.ok(gzipSize(random) > gzipSize(repetitive), "random bytes should not compress as well");
});

runTest("evaluateBudget sums eager gzip and stays under budget for a small build", () => {
  const assets = ["index.js", "vendor.js"];
  const contents = {
    "index.js": Buffer.from("console.log('app')"),
    "vendor.js": Buffer.from("x".repeat(50 * 1024))
  };

  const result = evaluateBudget({ assets, readAsset: (name) => contents[name] });
  assert.equal(result.entries.length, 2);
  assert.equal(result.totalGzipBytes, gzipSize(contents["index.js"]) + gzipSize(contents["vendor.js"]));
  assert.equal(result.overBudget, false);
  assert.deepEqual(result.violations, []);
  // Sorted heaviest first, so the report leads with the real cost.
  assert.equal(result.entries[0].name, "vendor.js");
});

runTest("evaluateBudget fails an over-budget build or a deferred dependency in an eager chunk", () => {
  const big = evaluateBudget({
    assets: ["index.js"],
    readAsset: () => randomBytes(200 * 1024),
    budgetBytes: 1024
  });
  assert.equal(big.overBudget, true, "200 kB of entropy must exceed a 1 kB budget");

  const leaked = evaluateBudget({
    assets: ["index.js"],
    readAsset: () => Buffer.from("import{toast}from'sonner';")
  });
  assert.equal(leaked.overBudget, false);
  assert.match(leaked.violations.join("\n"), /contains "sonner"/);

  const leakedMotion = evaluateBudget({
    assets: ["index.js"],
    readAsset: () => Buffer.from("/* framer-motion */")
  });
  assert.match(leakedMotion.violations.join("\n"), /contains "framer-motion"/);
});

runTest("expandStaticImports follows static imports but not dynamic ones", () => {
  const contents = {
    "index.js": 'import{a}from"./vendor.js";const p=import("./lazy.js");import"./side.js";',
    "vendor.js": 'export{a}from"./deep.js";',
    "deep.js": "export const a = 1;",
    "lazy.js": 'import"./hidden.js";',
    "side.js": "console.log('side');",
    "hidden.js": "console.log('hidden');"
  };

  const reachable = expandStaticImports(["index.js"], (name) => contents[name]);
  assert.deepEqual(reachable.sort(), ["deep.js", "index.js", "side.js", "vendor.js"]);
  assert.ok(!reachable.includes("lazy.js"), "a dynamic import is fetched on demand");
  assert.ok(!reachable.includes("hidden.js"), "nothing behind a dynamic import is eager");
});

runTest("the shipped budget is a real number of bytes", () => {
  assert.ok(EAGER_GZIP_BUDGET_BYTES >= 100 * 1024, "budget must not be below the measured 100.3 kB");
  assert.ok(EAGER_GZIP_BUDGET_BYTES <= 200 * 1024, "budget must stay tight enough to catch a 57 kB regression");
});

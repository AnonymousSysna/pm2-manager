#!/usr/bin/env node
/**
 * Eager payload budget for the client build.
 *
 * `client/dist/index.html` decides what a first-time visitor downloads before
 * anything renders. That set is small and deliberate: the toast stack sits
 * behind a dynamic import, so the eager chunks no longer carry its vendor code.
 * A single static import of `goey-toast` puts roughly 57 kB of gzip back into
 * the critical path, which is invisible in review and obvious here.
 *
 * Fails (exit 1) when the eager gzip total is over budget, or when an eager
 * chunk contains a dependency that is supposed to be deferred.
 *
 * Usage:
 *   node scripts/check-bundle-budget.js            # build, then audit
 *   node scripts/check-bundle-budget.js --no-build # audit existing client/dist
 *   node scripts/check-bundle-budget.js --json     # machine readable output
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "client", "dist");
const BUILD_SCRIPT = path.join(__dirname, "build-client-clean.js");

// Measured at 100.3 kB gzip after the toast stack moved off the critical path.
// The budget leaves room for real features and refuses the regression.
const EAGER_GZIP_BUDGET_BYTES = 120 * 1024;

// Markers for code that must stay out of the eager chunks. `goey-toast` vendors
// sonner and motion; neither name survives as a package path in a production
// build, but both appear as runtime identifiers inside their own bundles.
const DEFERRED_MARKERS = [
  { marker: "sonner", label: "toast stack (goey-toast vendors sonner)" },
  { marker: "framer-motion", label: "toast stack animation engine (motion)" }
];

const SCRIPT_SRC = /<script[^>]+src=["']([^"']+)["']/g;
const MODULE_PRELOAD = /<link[^>]+rel=["']modulepreload["'][^>]*>/g;
const ANY_HREF = /href=["']([^"']+)["']/g;

/** Every asset `index.html` pulls in before the app can render. */
function collectEagerAssets(html) {
  const found = [];
  for (const match of html.matchAll(SCRIPT_SRC)) {
    found.push(match[1]);
  }
  for (const tag of html.match(MODULE_PRELOAD) || []) {
    const href = [...tag.matchAll(ANY_HREF)][0];
    if (href) {
      found.push(href[1]);
    }
  }

  const names = found
    .map((url) => url.split("/").pop())
    .filter((name) => name && name.endsWith(".js"));

  return [...new Set(names)];
}

// `index.html` lists the entry and the chunks it preloads, but an eager chunk
// can pull in more with a plain `import "./x.js"`, and the browser blocks the
// first paint on that fetch too. Follow those edges so the budget describes what
// actually delays rendering. Dynamic imports (`import("./x.js")`) are a fetch on
// demand, so they are not followed.
const STATIC_IMPORT = /(?:\bfrom\s*|\bimport\s*)(?!\()["'](\.\/[^"']+\.js)["']/g;

function expandStaticImports(roots, readAsset) {
  const seen = new Set();
  const queue = [...roots];

  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);

    const text = readAsset(name).toString();
    for (const match of text.matchAll(STATIC_IMPORT)) {
      queue.push(match[1].split("/").pop());
    }
  }

  return [...seen];
}

function gzipSize(buffer) {
  return zlib.gzipSync(buffer, { level: zlib.constants.Z_BEST_COMPRESSION }).length;
}

/**
 * Pure decision step, so the budget and the marker rule can be tested without a
 * build. `readAsset(name)` returns the asset contents as a Buffer or string.
 */
function evaluateBudget({ assets, readAsset, budgetBytes = EAGER_GZIP_BUDGET_BYTES }) {
  const entries = [];
  const violations = [];
  let totalGzip = 0;

  for (const name of assets) {
    const contents = readAsset(name);
    const raw = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    const gzip = gzipSize(raw);
    totalGzip += gzip;
    entries.push({ name, rawBytes: raw.length, gzipBytes: gzip });

    for (const { marker, label } of DEFERRED_MARKERS) {
      if (raw.includes(marker)) {
        violations.push(`${name} contains "${marker}" (${label}); it must load on demand`);
      }
    }
  }

  entries.sort((a, b) => b.gzipBytes - a.gzipBytes);

  return {
    entries,
    totalGzipBytes: totalGzip,
    budgetBytes,
    overBudget: totalGzip > budgetBytes,
    violations
  };
}

function build() {
  const result = spawnSync(process.execPath, [BUILD_SCRIPT], { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  if (!args.includes("--no-build")) {
    build();
  }

  const indexPath = path.join(DIST, "index.html");
  if (!fs.existsSync(indexPath)) {
    console.error(`No build found at ${indexPath}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const html = fs.readFileSync(indexPath, "utf8");
  const roots = collectEagerAssets(html);
  if (roots.length === 0) {
    console.error("index.html references no eager scripts; the audit cannot run.");
    process.exit(1);
  }

  const readAsset = (name) => fs.readFileSync(path.join(DIST, "assets", name));
  const assets = expandStaticImports(roots, readAsset);
  const result = evaluateBudget({ assets, readAsset });

  const failed = result.overBudget || result.violations.length > 0;
  if (asJson) {
    console.log(JSON.stringify({ ...result, failed }, null, 2));
  } else {
    console.log(`Eager assets (${result.entries.length} reachable, ${roots.length} preloaded):`);
    for (const entry of result.entries) {
      console.log(
        `  ${entry.name}  ${(entry.rawBytes / 1024).toFixed(1)} kB raw  ${(entry.gzipBytes / 1024).toFixed(1)} kB gzip`
      );
    }
    const total = (result.totalGzipBytes / 1024).toFixed(1);
    const budget = (result.budgetBytes / 1024).toFixed(0);
    console.log(`Eager total: ${total} kB gzip (budget ${budget} kB)`);
    for (const violation of result.violations) {
      console.error(`FAIL ${violation}`);
    }
    if (result.overBudget) {
      console.error(`FAIL eager payload ${total} kB exceeds the ${budget} kB gzip budget`);
    }
    if (!failed) {
      console.log("Eager payload is within budget.");
    }
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectEagerAssets,
  expandStaticImports,
  evaluateBudget,
  gzipSize,
  EAGER_GZIP_BUDGET_BYTES,
  DEFERRED_MARKERS
};

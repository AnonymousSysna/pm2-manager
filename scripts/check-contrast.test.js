const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { contrastRatio } = require("./check-contrast");

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

runTest("contrastRatio matches known WCAG reference values", () => {
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
  assert.equal(contrastRatio([255, 255, 255], [255, 255, 255]), 1);
  // #777 on white is the classic ~4.48:1 boundary case.
  const grey = contrastRatio([119, 119, 119], [255, 255, 255]);
  assert.ok(grey > 4.4 && grey < 4.6, `expected ~4.48:1, got ${grey}`);
});

runTest("every required token pair passes AA in both themes", () => {
  const script = path.join(__dirname, "check-contrast.js");
  const { execFileSync } = require("child_process");
  let output = "";
  try {
    output = execFileSync(process.execPath, [script], { encoding: "utf8" });
  } catch (error) {
    throw new Error(`contrast audit failed:\n${error.stdout || ""}${error.stderr || ""}`);
  }
  assert.match(output, /All required pairs pass\./);
});

runTest("token blocks are present and parsed", () => {
  const { parseTokenBlock } = require("./check-contrast");
  const css = fs.readFileSync(path.join(__dirname, "..", "client", "src", "index.css"), "utf8");
  for (const selector of ['[data-theme="dark"]', '[data-theme="light"]']) {
    const tokens = parseTokenBlock(css, selector);
    assert.ok(tokens, `missing token block: ${selector}`);
    for (const token of ["bg", "surface", "surface-2", "surface-3", "border", "text-1", "text-2", "text-3"]) {
      assert.ok(Array.isArray(tokens[token]), `${selector} missing --color-${token}`);
    }
  }
});

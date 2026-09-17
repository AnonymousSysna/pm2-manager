const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildProcessEnv,
  parseEnvFile,
  resolveEnvFilePaths
} = require("./env-file");

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

runTest("parseEnvFile reads key/value pairs and ignores comments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-file-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "# comment\n\nPORT=9000\nQUOTED=\"has space\"\n", "utf8");

  assert.deepEqual(parseEnvFile(file), { PORT: "9000", QUOTED: "has space" });
  assert.deepEqual(parseEnvFile(path.join(dir, "missing")), {});
});

runTest("resolveEnvFilePaths prefers env-specific files over the base file", () => {
  const appRoot = path.resolve("D:/tmp/pm2-env-file-test");
  const serverRoot = path.join(appRoot, "server");
  const exists = (file) => [
    path.join(serverRoot, ".env.production"),
    path.join(appRoot, ".env.production"),
    path.join(appRoot, ".env")
  ].map((value) => path.resolve(value)).includes(path.resolve(file));

  assert.deepEqual(resolveEnvFilePaths({ appRoot, serverRoot, nodeEnv: "production", exists }), [
    path.join(serverRoot, ".env.production"),
    path.join(appRoot, ".env.production"),
    path.join(appRoot, ".env")
  ]);
});

runTest("buildProcessEnv layers specific files over the base file", () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-build-"));
  const serverRoot = path.join(appRoot, "server");
  fs.mkdirSync(serverRoot, { recursive: true });
  fs.writeFileSync(path.join(appRoot, ".env"), "PORT=8000\nSHARED=base\n", "utf8");
  fs.writeFileSync(path.join(serverRoot, ".env.production"), "PORT=9000\n", "utf8");

  const { nodeEnv, values } = buildProcessEnv({ appRoot, serverRoot, nodeEnv: "production" });

  assert.equal(nodeEnv, "production");
  assert.equal(values.PORT, "9000");
  assert.equal(values.SHARED, "base");
});

runTest("buildProcessEnv falls back to NODE_ENV or production", () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-default-"));

  assert.equal(buildProcessEnv({ appRoot, nodeEnv: "staging" }).nodeEnv, "staging");
  assert.equal(buildProcessEnv({ appRoot, env: {} }).nodeEnv, "production");
});

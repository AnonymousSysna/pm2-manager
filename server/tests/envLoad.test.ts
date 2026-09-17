const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  loadEnvironmentFiles,
  normalizeNodeEnv,
  resolveEnvFilePaths,
  resolveNodeEnv
} = require("../utils/envLoad");

const ROOT = path.resolve("D:/tmp/pm2-env-test");
const SERVER = path.join(ROOT, "server");

function fakeExists(...files) {
  const allowed = new Set(files.map((file) => path.resolve(file)));
  return (file) => allowed.has(path.resolve(file));
}

test("normalizeNodeEnv accepts known environments only", () => {
  assert.equal(normalizeNodeEnv("PRODUCTION"), "production");
  assert.equal(normalizeNodeEnv(" staging "), "staging");
  assert.equal(normalizeNodeEnv("banana"), "");
  assert.equal(normalizeNodeEnv(undefined), "");
});

test("resolveEnvFilePaths orders most specific first", () => {
  const paths = resolveEnvFilePaths({
    rootDir: ROOT,
    serverDir: SERVER,
    nodeEnv: "production",
    exists: fakeExists(
      path.join(SERVER, ".env.production"),
      path.join(ROOT, ".env.production"),
      path.join(SERVER, ".env"),
      path.join(ROOT, ".env")
    )
  });

  assert.deepEqual(paths, [
    path.join(SERVER, ".env.production"),
    path.join(ROOT, ".env.production"),
    path.join(SERVER, ".env"),
    path.join(ROOT, ".env")
  ]);
});

test("resolveEnvFilePaths skips missing files and env-specific files for unknown envs", () => {
  const paths = resolveEnvFilePaths({
    rootDir: ROOT,
    serverDir: SERVER,
    nodeEnv: "banana",
    exists: fakeExists(path.join(ROOT, ".env"))
  });

  assert.deepEqual(paths, [path.join(ROOT, ".env")]);
});

test("resolveNodeEnv prefers the runtime value, then the base file", () => {
  assert.equal(resolveNodeEnv({ rootDir: ROOT, serverDir: SERVER, env: { NODE_ENV: "staging" }, exists: fakeExists() }), "staging");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-"));
  fs.writeFileSync(path.join(tmp, ".env"), "NODE_ENV=production\n", "utf8");
  assert.equal(resolveNodeEnv({ rootDir: tmp, serverDir: path.join(tmp, "nope"), env: {}, exists: fs.existsSync }), "production");

  assert.equal(resolveNodeEnv({ rootDir: tmp, serverDir: path.join(tmp, "nope"), env: {}, exists: () => false }), "development");
});

test("loadEnvironmentFiles layers env-specific files over the base file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-load-"));
  const serverDir = path.join(tmp, "server");
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, ".env"), "PORT=8000\nOUTER=root\nSHARED=base\n", "utf8");
  fs.writeFileSync(path.join(serverDir, ".env"), "OUTER=server\n", "utf8");
  fs.writeFileSync(path.join(serverDir, ".env.production"), "PORT=9000\nONLY_PROD=1\n", "utf8");

  const env: Record<string, string> = { NODE_ENV: "production" };
  const result = loadEnvironmentFiles({ rootDir: tmp, serverDir, env });

  assert.equal(result.nodeEnv, "production");
  assert.equal(result.loaded.length, 3);
  assert.equal(env.PORT, "9000", "env-specific server file wins");
  assert.equal(env.OUTER, "server", "server dir wins over repo root");
  assert.equal(env.SHARED, "base");
  assert.equal(env.ONLY_PROD, "1");
});

test("loadEnvironmentFiles never clobbers variables the runtime already set", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-proc-"));
  fs.writeFileSync(path.join(tmp, ".env"), "PORT=8000\nJWT_SECRET=from-file\n", "utf8");

  const env: Record<string, string> = { PORT: "1234" };
  loadEnvironmentFiles({ rootDir: tmp, serverDir: path.join(tmp, "missing"), env });

  assert.equal(env.PORT, "1234");
  assert.equal(env.JWT_SECRET, "from-file");
  assert.equal(env.NODE_ENV, "development");
});

test("loadEnvironmentFiles tolerates a project with no env files", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-env-empty-"));
  const env: Record<string, string> = {};
  const result = loadEnvironmentFiles({ rootDir: tmp, serverDir: path.join(tmp, "server"), env });

  assert.deepEqual(result.loaded, []);
  assert.equal(result.nodeEnv, "development");
  assert.equal(env.NODE_ENV, "development");
});

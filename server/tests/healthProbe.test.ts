const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { runHealthCommand, probePm2Health } = require("../utils/healthProbe");
const { createProbeCache } = require("../utils/healthProbe");

const repoRoot = path.resolve(__dirname, "..", "..");

test("a successful command reports ok and captures its output", async () => {
  const result = await runHealthCommand(process.execPath, ["-e", "process.stdout.write('pm2-ok')"], {
    cwd: repoRoot,
    timeoutMs: 5000
  });

  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.output, "pm2-ok");
});

test("a command that cannot be spawned resolves with ok: false instead of rejecting", async () => {
  const missing = path.join(repoRoot, "definitely-not-a-real-command.cmd");
  const result = await runHealthCommand(missing, ["jlist"], { cwd: repoRoot, timeoutMs: 5000 });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, false, "a missing binary is not a timeout");
  assert.ok(result.output.length > 0, "the failure is reported, not swallowed");
});

test("npm itself runs, which is the shim a bare spawn cannot start on Windows", async () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await runHealthCommand(npm, ["--version"], { cwd: repoRoot, timeoutMs: 60000 });

  assert.equal(result.ok, true, `npm --version failed: ${result.output}`);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /\d+\.\d+\.\d+/);
});

test("a hung command is killed and reported as timed out", async () => {
  const result = await runHealthCommand(
    process.execPath,
    ["-e", "setTimeout(() => process.stdout.write('too late'), 60000)"],
    { cwd: repoRoot, timeoutMs: 1200 }
  );

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
});

test("a failing command reports its exit code and stderr", async () => {
  const result = await runHealthCommand(
    process.execPath,
    ["-e", "process.stderr.write('daemon offline'); process.exit(3)"],
    { cwd: repoRoot, timeoutMs: 5000 }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
  assert.match(result.output, /daemon offline/);
});

test("the probe always settles, whatever the command does", async () => {
  // The real probe may legitimately fail (no pm2 daemon in this environment) or
  // time out; what matters is that it answers, so /health and /ready can never
  // hang waiting for it.
  const started = Date.now();
  const result = await probePm2Health({ timeoutMs: 5000 });
  const elapsed = Date.now() - started;

  assert.equal(typeof result.ok, "boolean");
  assert.equal(typeof result.output, "string");
  assert.equal(typeof result.timedOut, "boolean");
  assert.ok(elapsed < 30000, `the probe took ${elapsed}ms; it must not wait on the daemon`);
});

function countedProbe() {
  let calls = 0;
  return {
    calls: () => calls,
    probe: async () => {
      calls += 1;
      return { ok: true, code: 0, timedOut: false, output: `call-${calls}` };
    }
  };
}

test("the cache reuses a settled answer until the window expires", async () => {
  const { probe, calls } = countedProbe();
  let clock = 1000;
  const cache = createProbeCache(probe, { ttlMs: 2000, now: () => clock });

  const first = await cache.read();
  assert.equal(calls(), 1);
  assert.equal(cache.takenAt(), 1000);

  clock += 1999;
  assert.deepEqual(await cache.read(), first, "inside the window the answer is reused");
  assert.equal(calls(), 1);

  clock += 1;
  const refreshed = await cache.read();
  assert.equal(calls(), 2, "the window is a maximum age, not a minimum");
  assert.notEqual(refreshed.output, first.output);
});

test("concurrent readers share the one run already in flight", async () => {
  let release: (value: { ok: boolean }) => void = () => {};
  const pending = new Promise<{ ok: boolean }>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const cache = createProbeCache(
    async () => {
      calls += 1;
      return pending;
    },
    { ttlMs: 2000 }
  );

  const readers = [cache.read(), cache.read(), cache.read()];
  assert.equal(calls, 1, "only the first reader starts a probe");
  release({ ok: true });
  await Promise.all(readers);
  assert.equal(calls, 1);
});

test("a failing probe is cached too, so a poller cannot hammer a broken daemon", async () => {
  let calls = 0;
  let clock = 0;
  const cache = createProbeCache(
    async () => {
      calls += 1;
      throw new Error(`boom-${calls}`);
    },
    { ttlMs: 1000, now: () => clock }
  );

  await assert.rejects(() => cache.read(), /boom-1/);
  await assert.rejects(() => cache.read(), /boom-1/, "the cached failure is replayed");
  assert.equal(calls, 1);

  clock = 1001;
  await assert.rejects(() => cache.read(), /boom-2/);
  assert.equal(calls, 2, "the failure is retried once the window expires");
});

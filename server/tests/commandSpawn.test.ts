const test = require("node:test");
const assert = require("node:assert/strict");
const {
  windowsShellRequired,
  toSpawnTarget,
  quoteForCmd,
  commandLineFor,
  terminationPlan
} = require("../utils/commandSpawn");

test("windowsShellRequired only flags Windows shims", () => {
  assert.equal(windowsShellRequired("npm.cmd", "win32"), true);
  assert.equal(windowsShellRequired("C:\\tools\\install.bat", "win32"), true);
  assert.equal(windowsShellRequired("NPM.CMD", "win32"), true, "the check is case-insensitive");

  assert.equal(windowsShellRequired("npm", "win32"), false);
  assert.equal(windowsShellRequired("node.exe", "win32"), false);
  assert.equal(windowsShellRequired("git", "win32"), false);

  assert.equal(windowsShellRequired("npm.cmd", "linux"), false, "the shell rule is Windows-only");
  assert.equal(windowsShellRequired("npm.cmd", "darwin"), false);
  assert.equal(windowsShellRequired("", "win32"), false);
});

test("quoteForCmd only quotes what cmd.exe would otherwise split", () => {
  assert.equal(quoteForCmd("jlist"), "jlist");
  assert.equal(quoteForCmd("--prefix"), "--prefix");
  assert.equal(quoteForCmd("C:\\Program Files\\node"), '"C:\\Program Files\\node"');
  assert.equal(quoteForCmd("say ^& exit"), '"say ^& exit"');
  assert.equal(quoteForCmd('a "quoted" token'), '"a ""quoted"" token"');
  assert.equal(quoteForCmd(""), '""');
});

test("toSpawnTarget routes a Windows shim through cmd.exe and leaves other platforms alone", () => {
  const pm2Probe = ["--prefix", "server", "exec", "pm2", "--", "jlist"];

  const windows = toSpawnTarget("npm.cmd", pm2Probe, "win32", "C:\\Windows\\System32\\cmd.exe");
  assert.equal(windows.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(windows.args, [
    "/d",
    "/s",
    "/c",
    "npm.cmd --prefix server exec pm2 -- jlist"
  ]);
  assert.equal(windows.display, "npm.cmd --prefix server exec pm2 -- jlist");

  const linux = toSpawnTarget("npm", pm2Probe, "linux");
  assert.equal(linux.command, "npm", "no interpreter is involved off Windows");
  assert.deepEqual(linux.args, pm2Probe);

  const windowsNode = toSpawnTarget("node.exe", ["-e", "1"], "win32");
  assert.equal(windowsNode.command, "node.exe", "a real executable is not wrapped");
});

test("commandLineFor quotes each token of the display string", () => {
  assert.equal(
    commandLineFor("npm.cmd", ["run", "my script"]),
    'npm.cmd run "my script"'
  );
});

test("terminationPlan kills the tree on Windows and signals elsewhere", () => {
  assert.deepEqual(terminationPlan({ pid: 4321 }, "win32"), {
    method: "taskkill",
    pid: 4321,
    signal: "SIGTERM"
  });
  assert.deepEqual(terminationPlan({ pid: 4321 }, "linux"), {
    method: "signal",
    pid: 4321,
    signal: "SIGTERM"
  });
  assert.equal(terminationPlan({}, "win32").method, "signal", "no pid means nothing to taskkill");
  assert.equal(terminationPlan({ pid: 0 }, "win32").pid, null);
});

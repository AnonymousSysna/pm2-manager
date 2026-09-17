const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  windowsShellRequired,
  toSpawnTarget,
  quoteForCmd,
  commandLineFor,
  terminationPlan
} = require("../utils/commandSpawn");

interface Attempt {
  threw: boolean;
  code: number | null;
  output: string;
}

/** Spawn something and report whether the launch itself threw. */
function attempt(command: string, args: string[]): Promise<Attempt> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (_error) {
      resolve({ threw: true, code: null, output: "" });
      return;
    }

    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", () => resolve({ threw: false, code: null, output }));
    child.on("close", (code) => resolve({ threw: false, code, output }));
  });
}

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

test(
  "a Windows shim runs for real once toSpawnTarget has wrapped it",
  { skip: process.platform !== "win32" ? "Windows-only: .cmd shims do not exist elsewhere" : false },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command-spawn-"));
    const shim = path.join(dir, "echo-args.cmd");
    fs.writeFileSync(shim, "@echo off\r\necho shim-ran %1\r\n");

    try {
      const direct = await attempt(shim, ["hello"]);
      assert.equal(direct.threw, true, "spawning a .cmd directly throws instead of emitting an error event");

      const target = toSpawnTarget(shim, ["hello"]);
      const wrapped = await attempt(target.command, target.args);
      assert.equal(wrapped.code, 0, wrapped.output);
      assert.match(wrapped.output, /shim-ran hello/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

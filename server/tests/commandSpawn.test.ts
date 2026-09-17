const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const {
  windowsShellRequired,
  toSpawnTarget,
  resolveExecutable,
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
function attempt(
  command: string,
  args: string[],
  options: { windowsVerbatimArguments?: boolean } = {}
): Promise<Attempt> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, ...options });
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
    '"npm.cmd --prefix server exec pm2 -- jlist"'
  ]);
  assert.equal(windows.display, "npm.cmd --prefix server exec pm2 -- jlist");
  assert.equal(
    windows.windowsVerbatimArguments,
    true,
    "the wrapped line must reach cmd.exe unescaped"
  );

  const linux = toSpawnTarget("npm", pm2Probe, "linux");
  assert.equal(linux.command, "npm", "no interpreter is involved off Windows");
  assert.deepEqual(linux.args, pm2Probe);
  assert.equal(linux.windowsVerbatimArguments, false);

  const windowsNode = toSpawnTarget("node.exe", ["-e", "1"], "win32");
  assert.equal(windowsNode.command, "node.exe", "a real executable is not wrapped");
  assert.equal(windowsNode.windowsVerbatimArguments, false);
});

test("a wrapped shim with a space in its path keeps the outer quote pair", () => {
  const target = toSpawnTarget("C:\\Program Files\\nodejs\\npm.cmd", ["--version"], "win32", "cmd.exe");

  assert.deepEqual(target.args, [
    "/d",
    "/s",
    "/c",
    '""C:\\Program Files\\nodejs\\npm.cmd" --version"'
  ]);
  assert.equal(target.display, '"C:\\Program Files\\nodejs\\npm.cmd" --version');
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
      const wrapped = await attempt(target.command, target.args, {
        windowsVerbatimArguments: target.windowsVerbatimArguments
      });
      assert.equal(wrapped.code, 0, wrapped.output);
      assert.match(wrapped.output, /shim-ran hello/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test("resolveExecutable finds a bare name through PATH and PATHEXT", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-executable-"));
  const shim = path.join(dir, "fake-manager.cmd");
  fs.writeFileSync(shim, "@echo off\r\n");

  try {
    const env = { PATH: `C:\\nope;${dir}`, PATHEXT: ".EXE;.CMD" };
    assert.equal(
      resolveExecutable("fake-manager", { platform: "win32", env, exists: fs.existsSync }),
      shim
    );
    assert.equal(
      resolveExecutable("missing-manager", { platform: "win32", env, exists: fs.existsSync }),
      null,
      "a name that is nowhere on PATH reports null so the caller keeps its own error"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveExecutable honours PATHEXT order and leaves explicit names alone", () => {
  const asked: string[] = [];
  const exists = (candidate: string) => {
    asked.push(path.win32.basename(candidate));
    return /\.exe$/i.test(candidate);
  };

  const found = resolveExecutable("manager", {
    platform: "win32",
    env: { PATH: "C:\\tools", PATHEXT: ".CMD;.EXE" },
    exists
  });
  assert.equal(path.win32.basename(found), "manager.exe", "the first existing extension wins");
  assert.ok(found.includes("C:\\tools"), `expected the PATH entry to be used, got ${found}`);
  assert.deepEqual(asked, ["manager.cmd", "manager.exe"], "extensions are tried in PATHEXT order");

  assert.equal(
    resolveExecutable("C:\\tools\\manager", { platform: "win32", env: { PATH: "C:\\tools" }, exists }),
    "C:\\tools\\manager",
    "a path is already explicit"
  );
  assert.equal(
    resolveExecutable("node.exe", { platform: "win32", env: { PATH: "C:\\tools" }, exists }),
    "node.exe",
    "an extension means the caller already named the file"
  );
  assert.equal(
    resolveExecutable("caddy", { platform: "linux", env: { PATH: "/usr/bin" }, exists }),
    "caddy",
    "the operating system resolves bare names off Windows"
  );
  assert.equal(resolveExecutable("", { platform: "win32", env: {} }), null);
});

test(
  "a resolved package-manager shim runs, where the bare name cannot",
  { skip: process.platform !== "win32" ? "Windows-only: PATHEXT resolution" : false },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-run-"));
    const shim = path.join(dir, "fake-manager.cmd");
    fs.writeFileSync(shim, "@echo off\r\necho manager-ran %1\r\n");

    try {
      const bare = await attempt("fake-manager", ["install"]);
      assert.equal(bare.code, null, "a bare name is not startable");
      assert.equal(bare.threw, false);

      const resolved = resolveExecutable("fake-manager", {
        platform: "win32",
        env: { PATH: dir, PATHEXT: ".CMD" },
        exists: fs.existsSync
      });
      assert.equal(resolved, shim);

      const target = toSpawnTarget(resolved, ["install"]);
      const ran = await attempt(target.command, target.args, {
        windowsVerbatimArguments: target.windowsVerbatimArguments
      });
      assert.equal(ran.code, 0, ran.output);
      assert.match(ran.output, /manager-ran install/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "a shim under a path with a space runs only in the canonical cmd.exe form",
  { skip: process.platform !== "win32" ? "Windows-only: cmd.exe quoting" : false },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaced shim "));
    const shim = path.join(dir, "echo args.cmd");
    fs.writeFileSync(shim, "@echo off\r\necho spaced-shim-ran %1\r\n");
    const comspec = process.env.ComSpec || "cmd.exe";

    try {
      // What the previous wrapping did: hand cmd.exe the display line as one
      // argument. With a quoted program inside it, Node escapes the quotes and cmd
      // reports the program as "not recognized".
      const naive = await attempt(comspec, [
        "/d",
        "/s",
        "/c",
        commandLineFor(shim, ["hello"])
      ]);
      assert.notEqual(naive.code, 0, `the naive form should not run: ${naive.output}`);
      assert.match(naive.output, /not recognized/i);

      const target = toSpawnTarget(shim, ["hello"]);
      const canonical = await attempt(target.command, target.args, {
        windowsVerbatimArguments: target.windowsVerbatimArguments
      });
      assert.equal(canonical.code, 0, canonical.output);
      assert.match(canonical.output, /spaced-shim-ran hello/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(__dirname, "build-tools.js");
const {
  findNativeDependencies,
  platformToolchain,
  detectMissingTools,
  buildToolInstallPlan,
  detectPlan,
  formatMissingToolchainMessage,
  isNativeBuildError,
  extractBuildErrorExcerpt,
  formatNativeBuildFailure,
  checkBuildTools,
  ensureBuildTools,
  runInstallPlan
} = require("./build-tools");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makePackageDir(packageJson, prefix = "pm2-build-tools-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const allPresent = () => true;
const allMissing = () => false;

// The exact failure an operator hits on a fresh Ubuntu/Debian VPS.
const GYP_FAILURE_OUTPUT = [
  "npm error code 1",
  "npm error path /root/pm2-manager/server/node_modules/node-pty",
  "npm error command failed",
  "npm error command sh -c node scripts/prebuild.js || node-gyp rebuild",
  "gyp ERR! build error",
  "gyp ERR! stack Error: not found: make",
  "gyp ERR! stack     at getNotFoundError (/usr/lib/node_modules/npm/node_modules/which/which.js:13:16)",
  "gyp ERR! System Linux 6.8.0-45-generic",
  "gyp ERR! node -v v22.22.0",
  "gyp ERR! node-gyp -v v12.1.0",
  "npm warn optional SKIPPING OPTIONAL DEPENDENCY: esbuild@0.25.0 (node_modules/esbuild): platform mismatch",
  "npm notice audit: 2 moderate severity vulnerabilities",
  "npm error A complete log of this run can be found in: /root/.npm/_logs/debug-0.log"
].join("\n");

runTest("findNativeDependencies only reports packages that compile native code", () => {
  const found = findNativeDependencies({
    dependencies: { express: "^4", "node-pty": "^1.1.0" },
    optionalDependencies: { "better-sqlite3": "^11" }
  });
  assert.deepEqual(found, ["better-sqlite3", "node-pty"]);
  assert.deepEqual(findNativeDependencies({ dependencies: { express: "^4" } }), []);
  assert.deepEqual(findNativeDependencies(null), []);
});

runTest("platformToolchain requires make, compilers, and python3 on Linux", () => {
  const ids = platformToolchain("linux").map((tool) => tool.id);
  assert.deepEqual(ids, ["make", "gcc", "g++", "python3"]);
  assert.deepEqual(platformToolchain("win32"), []);
});

runTest("detectMissingTools reports only tools that are absent", () => {
  const installed = new Set(["make", "gcc"]);
  const exists = (command) => installed.has(command);
  const missing = detectMissingTools("linux", exists).map((tool) => tool.id);
  assert.deepEqual(missing, ["g++", "python3"]);
  assert.deepEqual(detectMissingTools("linux", allPresent), []);
  assert.deepEqual(detectMissingTools("linux", allMissing).map((tool) => tool.id), ["make", "gcc", "g++", "python3"]);
  assert.deepEqual(detectMissingTools("linux", () => true), []);
});

runTest("buildToolInstallPlan produces the Ubuntu/Debian build-essential command", () => {
  const plan = buildToolInstallPlan("linux", { "apt-get": true }, "sudo");
  assert.deepEqual(plan.commands, [
    "sudo apt-get update",
    "sudo apt-get install -y build-essential python3"
  ]);
  assert.equal(plan.supported, true);
});

runTest("buildToolInstallPlan omits elevation when already root", () => {
  const plan = buildToolInstallPlan("linux", { "apt-get": true }, null);
  assert.deepEqual(plan.commands, [
    "apt-get update",
    "apt-get install -y build-essential python3"
  ]);
});

runTest("buildToolInstallPlan covers dnf, pacman, zypper, apk, and macOS", () => {
  assert.match(buildToolInstallPlan("linux", { dnf: true }, "sudo").commands[0], /dnf install -y make gcc gcc-c\+\+ python3/);
  assert.match(buildToolInstallPlan("linux", { yum: true }, "sudo").commands[0], /yum install -y/);
  assert.match(buildToolInstallPlan("linux", { pacman: true }, "sudo").commands[0], /pacman -Sy --noconfirm base-devel python/);
  assert.match(buildToolInstallPlan("linux", { zypper: true }, "sudo").commands[0], /zypper --non-interactive install/);
  assert.match(buildToolInstallPlan("linux", { apk: true }, "sudo").commands[0], /apk add --no-cache build-base python3/);
  assert.deepEqual(buildToolInstallPlan("darwin", {}, null).commands, ["xcode-select --install"]);
});

runTest("buildToolInstallPlan reports an unsupported system instead of guessing", () => {
  const plan = buildToolInstallPlan("linux", {}, "sudo");
  assert.equal(plan.supported, false);
  // Failures are printed for the common Debian/Ubuntu case, but `supported:
  // false` guarantees the installer never runs them on an unknown system.
  assert.deepEqual(plan.commands, [
    "sudo apt-get update",
    "sudo apt-get install -y build-essential python3"
  ]);
  assert.match(plan.note, /No supported package manager/);
});

runTest("detectPlan picks the detected package manager and elevation", () => {
  const plan = detectPlan("linux", (command) => command === "apt-get");
  assert.equal(plan.supported, true);
  assert.deepEqual(plan.commands, [
    "apt-get update",
    "apt-get install -y build-essential python3"
  ]);

  const elevated = detectPlan("linux", (command) => ["apt-get", "doas"].includes(command));
  assert.deepEqual(elevated.commands, [
    "doas apt-get update",
    "doas apt-get install -y build-essential python3"
  ]);
});

runTest("formatMissingToolchainMessage accepts an explicit reason line", () => {
  const message = formatMissingToolchainMessage({
    platform: "linux",
    missingTools: [],
    plan: buildToolInstallPlan("linux", { "apt-get": true }, "sudo"),
    packageDir: "/root/pm2-manager/server",
    nativeDependencies: ["node-pty"],
    reason: "Custom heading."
  });
  assert.equal(message.split("\n")[0], "Custom heading.");
});

runTest("formatMissingToolchainMessage is actionable and free of npm noise", () => {
  const plan = buildToolInstallPlan("linux", { "apt-get": true }, "sudo");
  const message = formatMissingToolchainMessage({
    platform: "linux",
    missingTools: detectMissingTools("linux", allMissing),
    plan,
    packageDir: "/root/pm2-manager/server",
    nativeDependencies: ["node-pty"]
  });

  assert.match(message, /Native build tools are missing/);
  assert.match(message, /node-pty/);
  assert.match(message, /GNU make/);
  assert.match(message, /sudo apt-get install -y build-essential python3/);
  assert.match(message, /npm run setup/);
  assert.doesNotMatch(message, /gyp ERR!/);
});

runTest("isNativeBuildError recognizes the reported gyp failure", () => {
  assert.equal(isNativeBuildError(GYP_FAILURE_OUTPUT), true);
  assert.equal(isNativeBuildError("npm error code E404\nnpm error 404 Not Found"), false);
});

runTest("extractBuildErrorExcerpt keeps the cause and drops esbuild/audit noise", () => {
  const excerpt = extractBuildErrorExcerpt(GYP_FAILURE_OUTPUT);
  const joined = excerpt.join("\n");
  assert.match(joined, /not found: make/);
  assert.doesNotMatch(joined, /esbuild/);
  assert.doesNotMatch(joined, /audit/);
  assert.ok(excerpt.length <= 14);
});

runTest("formatNativeBuildFailure points at the toolchain and never dumps the full log", () => {
  const plan = buildToolInstallPlan("linux", { "apt-get": true }, "sudo");
  const message = formatNativeBuildFailure({
    name: "server",
    packageDir: "/root/pm2-manager/server",
    nativeDependencies: ["node-pty"],
    plan,
    output: GYP_FAILURE_OUTPUT
  });

  assert.match(message, /\[server\] npm install failed while compiling native dependencies: node-pty/);
  assert.match(message, /not found: make/);
  // The compile-failure path cannot prove the toolchain is missing, so it must
  // not claim that; it points at the toolchain conditionally instead.
  assert.match(message, /usually means the build toolchain is missing/);
  assert.doesNotMatch(message, /^Native build tools are missing\.$/m);
  assert.match(message, /sudo apt-get install -y build-essential python3/);
  assert.match(message, /esbuild platform-availability warnings and audit notices are unrelated/);
  assert.ok(message.split("\n").length < 30, "message should stay readable");
});

runTest("checkBuildTools requires a toolchain only for native packages", () => {
  const nativeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });
  const plainDir = makePackageDir({ name: "client", dependencies: { react: "^18" } });

  try {
    const nativeCheck = checkBuildTools({ packageDir: nativeDir, platform: "linux", commandExists: allMissing });
    assert.equal(nativeCheck.required, true);
    assert.deepEqual(nativeCheck.nativeDependencies, ["node-pty"]);
    assert.equal(nativeCheck.missingTools.length, 4);

    const readyCheck = checkBuildTools({ packageDir: nativeDir, platform: "linux", commandExists: allPresent });
    assert.equal(readyCheck.required, false);

    const plainCheck = checkBuildTools({ packageDir: plainDir, platform: "linux", commandExists: allMissing });
    assert.equal(plainCheck.required, false);
    assert.deepEqual(plainCheck.missingTools, []);

    // Windows installs use prebuilt binaries, so we never block there.
    const windowsCheck = checkBuildTools({ packageDir: nativeDir, platform: "win32", commandExists: allMissing });
    assert.equal(windowsCheck.required, false);
  } finally {
    cleanup(nativeDir);
    cleanup(plainDir);
  }
});

runTest("ensureBuildTools installs the toolchain when it is allowed to", () => {
  const nativeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });
  const calls = [];
  let toolchainReady = false;
  const commandExists = (command) => toolchainReady || ["apt-get", "sudo"].includes(command);
  const logger = { log: () => {} };

  try {
    const result = ensureBuildTools({
      packageDir: nativeDir,
      platform: "linux",
      commandExists,
      canInstall: () => true,
      install: (commands) => {
        calls.push(commands);
        toolchainReady = true;
        return { ok: true };
      },
      logger
    });

    assert.equal(result.ok, true);
    assert.equal(result.installed, true);
    assert.deepEqual(calls[0], ["sudo apt-get update", "sudo apt-get install -y build-essential python3"]);
  } finally {
    cleanup(nativeDir);
  }
});

runTest("ensureBuildTools does not install when tools are already present", () => {
  const nativeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });
  let installed = false;

  try {
    const result = ensureBuildTools({
      packageDir: nativeDir,
      platform: "linux",
      commandExists: allPresent,
      canInstall: () => true,
      install: () => {
        installed = true;
        return { ok: true };
      },
      logger: { log: () => {} }
    });

    assert.equal(result.ok, true);
    assert.equal(result.installed, false);
    assert.equal(installed, false);
  } finally {
    cleanup(nativeDir);
  }
});

runTest("ensureBuildTools refuses silently and returns the actionable message without privileges", () => {
  const nativeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });
  let installed = false;

  try {
    const result = ensureBuildTools({
      packageDir: nativeDir,
      platform: "linux",
      commandExists: (command) => ["apt-get", "sudo"].includes(command),
      canInstall: () => false,
      install: () => {
        installed = true;
        return { ok: true };
      },
      logger: { log: () => {} }
    });

    assert.equal(result.ok, false);
    assert.equal(result.installed, false);
    assert.equal(installed, false);
    assert.match(result.error, /Fix it with:/);
    assert.match(result.error, /sudo apt-get install -y build-essential python3/);
  } finally {
    cleanup(nativeDir);
  }
});

runTest("ensureBuildTools surfaces a failed package install as an actionable error", () => {
  const nativeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });

  try {
    const result = ensureBuildTools({
      packageDir: nativeDir,
      platform: "linux",
      commandExists: (command) => ["apt-get", "sudo"].includes(command),
      canInstall: () => true,
      install: (commands) => ({ ok: false, command: commands[1], status: 100 }),
      logger: { log: () => {} }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /Failed to install native build tools/);
    assert.match(result.error, /build-essential python3/);
  } finally {
    cleanup(nativeDir);
  }
});

runTest("ensureBuildTools is a no-op for packages without native dependencies", () => {
  const plainDir = makePackageDir({ name: "client", dependencies: { react: "^18" } });

  try {
    const result = ensureBuildTools({
      packageDir: plainDir,
      platform: "linux",
      commandExists: allMissing,
      canInstall: () => true,
      install: () => {
        throw new Error("install must not be called");
      },
      logger: { log: () => {} }
    });

    assert.equal(result.ok, true);
    assert.equal(result.required, false);
  } finally {
    cleanup(plainDir);
  }
});

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

runTest("runInstallPlan runs commands in order inside the package directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-install-plan-"));

  try {
    const ok = runInstallPlan([
      `node -e "require('fs').writeFileSync('first.txt','1')"`,
      `node -e "require('fs').writeFileSync('second.txt','2')"`
    ], { cwd: dir });

    assert.equal(ok.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, "first.txt"), "utf8"), "1");
    assert.equal(fs.readFileSync(path.join(dir, "second.txt"), "utf8"), "2");
  } finally {
    cleanup(dir);
  }
});

runTest("runInstallPlan stops at the first failing command and reports it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-install-plan-fail-"));

  try {
    const failed = runInstallPlan([
      `node -e "process.exit(7)"`,
      `node -e "require('fs').writeFileSync('never.txt','x')"`
    ], { cwd: dir });

    assert.equal(failed.ok, false);
    assert.equal(failed.status, 7);
    assert.match(failed.command, /process\.exit\(7\)/);
    assert.equal(fs.existsSync(path.join(dir, "never.txt")), false);
  } finally {
    cleanup(dir);
  }
});

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

runTest("CLI --json reports native dependencies for a package", () => {
  const nativeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });

  try {
    const result = runCli(["--check", "--json", "--dir", nativeDir]);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.nativeDependencies, ["node-pty"]);
    // On a bare Linux box this legitimately reports missing tools, so tie the
    // exit code to the reported result instead of hardcoding success.
    assert.equal(result.status, parsed.ok ? 0 : 1);
    assert.equal(parsed.required, !parsed.ok);
  } finally {
    cleanup(nativeDir);
  }
});

runTest("CLI --quiet is silent on success so npm preinstall stays clean", () => {
  // A package without native dependencies never needs a toolchain on any
  // platform, so this keeps the assertion host-independent.
  const plainDir = makePackageDir({ name: "client", dependencies: { react: "^18" } });

  try {
    const result = runCli(["--check", "--quiet", "--dir", plainDir]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "");
  } finally {
    cleanup(plainDir);
  }
});

runTest("CLI reports missing build tools with a non-zero exit code", () => {
  // Force the Linux toolchain probe and hide every system binary, so the CLI
  // sees exactly what a bare Ubuntu box sees: no make, gcc, g++, or python3.
  const probeDir = makePackageDir({ name: "server", dependencies: { "node-pty": "^1.1.0" } });
  const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-empty-path-"));

  try {
    const script = fs.readFileSync(CLI, "utf8").split("platform = process.platform").join('platform = "linux"');
    fs.writeFileSync(path.join(probeDir, "build-tools.js"), script, "utf8");

    const result = spawnSync(process.execPath, ["build-tools.js", "--check", "--quiet", "--dir", "."], {
      cwd: probeDir,
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath }
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Native build tools are missing/);
    assert.match(result.stdout, /build-essential python3/);
    assert.match(result.stdout, /npm run setup/);
    assert.doesNotMatch(result.stdout, /gyp ERR!/);
  } finally {
    cleanup(probeDir);
    cleanup(emptyPath);
  }
});

console.log("Build tool preflight checks completed.");

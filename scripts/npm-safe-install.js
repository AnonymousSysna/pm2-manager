#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ensureBuildTools,
  findNativeDependencies,
  readPackageJson,
  isNativeBuildError,
  formatNativeBuildFailure
} = require("./build-tools.js");

const appDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const NATIVE_DEPENDENCY_HINT = "build-essential python3";

class InstallError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "InstallError";
    this.kind = options.kind || "install";
  }
}

const TARGETS = {
  root: appDir,
  server: path.join(appDir, "server"),
  client: path.join(appDir, "client")
};

function parseArgs(argv) {
  const flags = new Set();
  const targets = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      flags.add(arg);
    } else {
      targets.push(arg);
    }
  }
  return { flags, targets };
}

function run(args, cwd) {
  const options = {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12
  };

  // npm on Windows is npm.cmd, and Node refuses to spawn .cmd shims directly
  // (spawn EINVAL, with no output captured). Going through cmd.exe keeps the
  // failure visible, which is what the native-build detection relies on.
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", [npmCommand, ...args].join(" ")], options)
    : spawnSync(npmCommand, args, options);

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.error) {
    return { ok: false, status: result.status ?? 1, output: `${output}\n${result.error.message}` };
  }

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    output
  };
}

function printTail(output, maxLines = 24) {
  const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-maxLines);
  for (const line of tail) {
    console.log(line);
  }
}

function tailText(output, maxLines = 12) {
  const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines).join("\n");
}

function isNpmTreeError(output) {
  const text = String(output || "").toLowerCase();
  return (
    text.includes("edgesout") ||
    text.includes("cannot read properties of null") ||
    text.includes("tracker \"idealtree\" already exists") ||
    text.includes("arborist") ||
    text.includes("idealtree")
  );
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function hasPackageJson(dir) {
  return fs.existsSync(path.join(dir, "package.json"));
}

// Native modules such as node-pty compile through node-gyp, so npm needs
// make/g++/python3 before it can even resolve the tree. Check that first and
// install the packages ourselves when we are allowed to; otherwise fail with a
// single paste-ready command instead of a wall of gyp output.
function prepareNativeBuildTools(name, dir, options = {}) {
  if (String(process.env.PM2_MANAGER_SKIP_BUILD_TOOLS || "") === "1") {
    return null;
  }

  let result;
  try {
    result = ensureBuildTools({
      packageDir: dir,
      allowInstall: options.autoInstallBuildTools !== false
    });
  } catch (error) {
    throw new InstallError(
      `[${name}] Unable to verify native build tools: ${error?.message || error}\n` +
        `- Install ${NATIVE_DEPENDENCY_HINT} manually, then re-run: npm run setup`,
      { kind: "build-tools" }
    );
  }

  if (result && result.ok === false) {
    throw new InstallError(`[${name}] ${result.error}`, { kind: "build-tools" });
  }

  return result;
}

function cleanInstallArtifacts(dir, { removeLock = false } = {}) {
  removePath(path.join(dir, "node_modules"));
  if (removeLock) {
    removePath(path.join(dir, "package-lock.json"));
  }
}

function installTarget(name, options = {}) {
  const dir = TARGETS[name];
  if (!dir || !hasPackageJson(dir)) {
    throw new Error(`Unknown npm install target: ${name}`);
  }

  if (name === "root" && !options.includeRoot) {
    console.log("[root] skipped; production install only needs server and client dependencies.");
    return;
  }

  const buildTools = prepareNativeBuildTools(name, dir, options);
  // The preflight may have been skipped; fall back to reading package.json so the
  // failure message still names the native dependency that failed to compile.
  const nativeDependencies = (buildTools?.nativeDependencies || []).length
    ? buildTools.nativeDependencies
    : findNativeDependencies(readPackageJson(dir));

  // Clean only after the toolchain check, so a missing-toolchain failure never
  // leaves the directory without its existing node_modules.
  if (options.clean) {
    console.log(`[${name}] cleaning node_modules before install...`);
    cleanInstallArtifacts(dir);
  }

  const hasLock = fs.existsSync(path.join(dir, "package-lock.json"));
  const attempts = [];

  if (hasLock) {
    attempts.push({ label: "npm ci", args: ["ci", "--no-audit", "--fund=false"] });
  }

  // Do not rewrite package-lock.json during installer runs. Rewriting locks on a VPS is what
  // caused later git-pull conflicts like client/package-lock.json being dirty.
  attempts.push({
    label: "npm install (lock-safe)",
    args: ["install", "--package-lock=false", "--no-audit", "--fund=false"]
  });

  let lastOutput = "";
  for (const attempt of attempts) {
    console.log(`[${name}] ${attempt.label}...`);
    const result = run(attempt.args, dir);
    if (result.ok) {
      console.log(`[${name}] dependencies ready.`);
      return;
    }

    lastOutput = result.output;
    console.log(`[${name}] ${attempt.label} failed.`);

    if (isNativeBuildError(result.output)) {
      throw new InstallError(
        formatNativeBuildFailure({
          name,
          packageDir: dir,
          nativeDependencies,
          plan: buildTools?.plan,
          output: result.output
        }),
        { kind: "native-build" }
      );
    }

    printTail(result.output);

    if (isNpmTreeError(result.output)) {
      console.log(`[${name}] npm dependency tree/cache issue detected. Verifying npm cache and retrying clean...`);
      run(["cache", "verify"], appDir);
      cleanInstallArtifacts(dir);
    }
  }

  if (isNpmTreeError(lastOutput)) {
    console.log(`[${name}] final recovery attempt after npm cache clean...`);
    run(["cache", "clean", "--force"], appDir);
    cleanInstallArtifacts(dir);
    const recovery = run(["install", "--package-lock=false", "--no-audit", "--fund=false"], dir);
    if (recovery.ok) {
      console.log(`[${name}] dependencies ready after recovery.`);
      return;
    }
    lastOutput = recovery.output;
    printTail(recovery.output);
  }

  if (isNativeBuildError(lastOutput)) {
    throw new InstallError(
      formatNativeBuildFailure({
        name,
        packageDir: dir,
        nativeDependencies,
        plan: buildTools?.plan,
        output: lastOutput
      }),
      { kind: "native-build" }
    );
  }

  // Keep the failure readable: npm verbose logs are available on demand.
  const tail = tailText(lastOutput) || "(npm produced no output; see the full log below)";
  throw new InstallError(
    [
      `[${name}] npm dependency install failed.`,
      "",
      "Last npm output:",
      tail,
      "",
      `Full log: npm ci --prefix "${dir}" --loglevel=verbose`
    ].join("\n"),
    { kind: "install" }
  );
}

function resolveTargets(rawTargets, includeRoot) {
  const selected = rawTargets.length ? rawTargets : ["all"];
  const expanded = [];

  for (const target of selected) {
    if (target === "all") {
      if (includeRoot) expanded.push("root");
      expanded.push("server", "client");
      continue;
    }
    expanded.push(target);
  }

  return Array.from(new Set(expanded));
}

function main() {
  const { flags, targets: rawTargets } = parseArgs(process.argv.slice(2));
  const includeRoot = flags.has("--include-root");
  const clean = flags.has("--clean");
  const selectedTargets = resolveTargets(rawTargets, includeRoot);

  if (flags.has("--verify-cache")) {
    console.log("[npm] verifying cache...");
    run(["cache", "verify"], appDir);
  }

  for (const target of selectedTargets) {
    installTarget(target, { includeRoot, clean });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  InstallError,
  isNpmTreeError,
  prepareNativeBuildTools,
  tailText,
  resolveTargets,
  installTarget
};

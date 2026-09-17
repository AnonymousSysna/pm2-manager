#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const appDir = path.resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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
  const result = spawnSync(npmCommand, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 12
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    output: `${result.stdout || ""}${result.stderr || ""}`
  };
}

function printTail(output, maxLines = 24) {
  const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-maxLines);
  for (const line of tail) {
    console.log(line);
  }
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

  throw new Error(`[${name}] npm dependency install failed. Last npm output:\n${String(lastOutput).trim()}`);
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
  isNpmTreeError,
  resolveTargets,
  installTarget
};

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const appDir = path.resolve(__dirname, "..");
const clientDir = path.join(appDir, "client");
const clientDist = path.join(appDir, "client", "dist");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

const REQUIRED_CLIENT_PACKAGES = [
  path.join(clientDir, "node_modules", "@xterm", "xterm", "package.json"),
  path.join(clientDir, "node_modules", "@xterm", "addon-fit", "package.json")
];

function removeDist() {
  if (!fs.existsSync(clientDist)) {
    return;
  }
  fs.rmSync(clientDist, { recursive: true, force: true });
  console.log(`Removed old client build: ${clientDist}`);
}

function runBuild() {
  const result = runNpm(["--prefix", "client", "run", "build"], appDir);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runNpm(args, cwd) {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", [npmBin, ...args].join(" ")], {
      cwd,
      stdio: "inherit",
      env: process.env
    });
  }

  return spawnSync(npmBin, args, {
    cwd,
    stdio: "inherit",
    env: process.env
  });
}

function ensureClientDependencies() {
  const missingRequiredPackage = REQUIRED_CLIENT_PACKAGES.some((packagePath) => !fs.existsSync(packagePath));
  if (!missingRequiredPackage) {
    return;
  }

  console.log("Client dependencies are missing or stale. Installing before build...");
  const result = runNpm(["ci", "--no-audit", "--fund=false"], clientDir);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

removeDist();
ensureClientDependencies();
runBuild();

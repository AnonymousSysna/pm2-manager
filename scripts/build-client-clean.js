#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const appDir = path.resolve(__dirname, "..");
const clientDist = path.join(appDir, "client", "dist");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

function removeDist() {
  if (!fs.existsSync(clientDist)) {
    return;
  }
  fs.rmSync(clientDist, { recursive: true, force: true });
  console.log(`Removed old client build: ${clientDist}`);
}

function runBuild() {
  const result = spawnSync(npmBin, ["--prefix", "client", "run", "build"], {
    cwd: appDir,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

removeDist();
runBuild();

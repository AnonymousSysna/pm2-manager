#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ensureRuntimeEnv } = require("./env-bootstrap");

const APP_NAME = "pm2-dashboard";
const appDir = path.resolve(__dirname, "..");
const pm2Bin = process.platform === "win32"
  ? path.join(appDir, "server", "node_modules", ".bin", "pm2.cmd")
  : path.join(appDir, "server", "node_modules", ".bin", "pm2");
const ecosystemFile = path.join(appDir, "ecosystem.config.js");

function ensureReady() {
  if (!fs.existsSync(pm2Bin)) {
    console.error(`Local PM2 was not found at ${pm2Bin}`);
    console.error("Run: npm --prefix server install");
    process.exit(1);
  }
  if (!fs.existsSync(ecosystemFile)) {
    console.error(`Missing ecosystem config: ${ecosystemFile}`);
    process.exit(1);
  }
}

function loadRuntimeEnv() {
  return ensureRuntimeEnv({ print: command !== "logs" && command !== "status" && command !== "describe" });
}

function buildPm2Env() {
  loadRuntimeEnv();
  return { ...process.env };
}

function run(args, options = {}) {
  ensureReady();
  const result = spawnSync(pm2Bin, args, {
    cwd: appDir,
    env: options.skipEnvBootstrap ? process.env : buildPm2Env(),
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });
  if (options.quiet) {
    return result;
  }
  process.exit(result.status ?? 1);
}

function isRunning() {
  const result = run(["describe", APP_NAME], { quiet: true });
  return result.status === 0;
}

const command = process.argv[2] || "status";
const rest = process.argv.slice(3);

switch (command) {
  case "start":
    run(["start", ecosystemFile, ...rest]);
    break;
  case "restart":
    if (isRunning()) {
      run(["restart", APP_NAME, "--update-env", ...rest]);
    } else {
      run(["start", ecosystemFile, ...rest]);
    }
    break;
  case "stop":
    run(["stop", APP_NAME, ...rest]);
    break;
  case "delete":
    run(["delete", APP_NAME, ...rest]);
    break;
  case "logs":
    run(["logs", APP_NAME, ...rest]);
    break;
  case "status":
    run(["status", ...rest]);
    break;
  case "describe":
    run(["describe", APP_NAME, ...rest]);
    break;
  case "save":
    run(["save", ...rest]);
    break;
  default:
    run([command, ...rest]);
}

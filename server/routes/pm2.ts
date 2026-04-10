// @ts-nocheck
const os = require("os");
const fs = require("fs");
const path = require("path");
const express = require("express");
const pm2 = require("pm2");
const pm2Package = require("pm2/package.json");
const { spawn } = require("child_process");
const { verifyToken } = require("../middleware/auth");
const { withPM2 } = require("../utils/pm2Client");
const { withPermissionHint } = require("../utils/permissionHints");
const { readLimiter, criticalWriteLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { trackPm2Operation } = require("../middleware/metrics");

const router = express.Router();

router.use(verifyToken);
router.use(readLimiter);

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;

function runCommand(command, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: Number(code || 0),
        timedOut,
        stdout,
        stderr
      });
    });
  });
}

function detectStartupInstruction(output = "") {
  const text = String(output || "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const explicitCommand = lines.find((line) =>
    /(?:sudo|doas|\bpkexec\b).*\bpm2\b.*\bstartup\b/i.test(line)
  );
  if (explicitCommand) {
    return explicitCommand;
  }

  const pm2Command = lines.find((line) => /\bpm2\b.*\bstartup\b/i.test(line));
  if (pm2Command) {
    return pm2Command;
  }

  return "";
}

async function fileExists(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch (_error) {
    return false;
  }
}

function getPm2HomeDir() {
  const value = String(process.env.PM2_HOME || "").trim();
  if (value) {
    return path.resolve(value);
  }
  return path.join(os.homedir(), ".pm2");
}

function isStartupPersistenceVerified(startupStatus, dumpExists) {
  return Boolean(dumpExists) && startupStatus?.enabled === true;
}

async function detectStartupEnabled() {
  if (process.platform !== "linux") {
    return { supported: false, enabled: null, manager: null, service: null, output: "" };
  }

  const user = String(process.env.USER || os.userInfo()?.username || "root").trim() || "root";
  const candidates = [`pm2-${user}`, `pm2-${user}.service`];

  for (const service of candidates) {
    const result = await runCommand("systemctl", ["is-enabled", service]);
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim().toLowerCase();
    if (result.code === 0 && output.includes("enabled")) {
      return { supported: true, enabled: true, manager: "systemd", service, output };
    }
  }

  return { supported: true, enabled: false, manager: "systemd", service: candidates[0], output: "" };
}

router.post("/save", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.dump((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ saved: true });
        });
      })
  );

  trackPm2Operation("save", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/resurrect", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.resurrect((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ resurrected: true });
        });
      })
  );

  trackPm2Operation("resurrect", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/kill", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.killDaemon((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ killed: true });
        });
      })
  );

  trackPm2Operation("kill", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

router.post("/startup", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const pm2Command = process.platform === "win32" ? "pm2.cmd" : "pm2";
  const pm2Home = getPm2HomeDir();
  const dumpPath = path.join(pm2Home, "dump.pm2");

  const preStartup = await detectStartupEnabled();
  const preDumpExists = await fileExists(dumpPath);
  const alreadyPersisted = preStartup.enabled === true && preDumpExists === true;

  if (alreadyPersisted) {
    trackPm2Operation("startup", true);
    res.status(200).json({
      success: true,
      data: {
        alreadyPersisted: true,
        activated: false,
        startupEnabled: true,
        dumpSaved: true,
        startup: null,
        save: null,
        instructionCommand: null,
        message: "PM2 startup persistence is already enabled."
      },
      error: null
    });
    return;
  }

  const startupAttempt = await runCommand(pm2Command, ["startup"]);
  const startupOutput = `${startupAttempt.stdout || ""}\n${startupAttempt.stderr || ""}`.trim();
  const instructionCommand = detectStartupInstruction(startupOutput);
  const startupSuccess = startupAttempt.code === 0 && !startupAttempt.timedOut;

  let saveAttempt = null;
  let saveSuccess = false;
  if (startupSuccess) {
    saveAttempt = await runCommand(pm2Command, ["save"]);
    saveSuccess = saveAttempt.code === 0 && !saveAttempt.timedOut;
  }

  const postStartup = await detectStartupEnabled();
  const postDumpExists = await fileExists(dumpPath);
  const persistedNow = isStartupPersistenceVerified(postStartup, postDumpExists);

  const operationSuccess = startupSuccess && saveSuccess && persistedNow;
  trackPm2Operation("startup", operationSuccess);

  const failureError = startupSuccess
    ? "pm2 save failed or persistence check did not pass"
    : instructionCommand
      ? `Startup requires elevated command: ${instructionCommand}`
      : "pm2 startup failed";

  res.status(operationSuccess ? 200 : 500).json({
    success: operationSuccess,
    data: {
      alreadyPersisted: false,
      activated: operationSuccess,
      startupEnabled: postStartup.enabled,
      dumpSaved: postDumpExists,
      startup: {
        code: startupAttempt.code,
        timedOut: startupAttempt.timedOut,
        command: `${pm2Command} startup`,
        output: startupOutput.slice(-8000)
      },
      save: saveAttempt
        ? {
            code: saveAttempt.code,
            timedOut: saveAttempt.timedOut,
            command: `${pm2Command} save`,
            output: `${saveAttempt.stdout || ""}\n${saveAttempt.stderr || ""}`.trim().slice(-4000)
          }
        : null,
      instructionCommand: instructionCommand || null,
      message: operationSuccess
        ? "PM2 startup persistence has been enabled."
        : "PM2 startup persistence activation failed."
    },
    error: operationSuccess
      ? null
      : withPermissionHint(failureError, {
          command: startupSuccess ? pm2Command : instructionCommand || `${pm2Command} startup`,
          args: startupSuccess ? ["save"] : []
        })
  });
}));

router.get("/info", asyncHandler(async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.list((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            pm2Version: pm2Package.version || "unknown",
            nodeVersion: process.version,
            pm2Home: process.env.PM2_HOME || os.homedir()
          });
        });
      })
  );

  trackPm2Operation("info", result.success);
  res.status(result.success ? 200 : 500).json(result);
}));

module.exports = router;
module.exports.isStartupPersistenceVerified = isStartupPersistenceVerified;


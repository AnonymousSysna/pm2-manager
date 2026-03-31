// @ts-nocheck
const os = require("os");
const express = require("express");
const pm2 = require("pm2");
const pm2Package = require("pm2/package.json");
const { spawn } = require("child_process");
const { verifyToken } = require("../middleware/auth");
const { withPM2 } = require("../utils/pm2Client");
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
  const startupAttempt = await runCommand(pm2Command, ["startup"]);
  const combinedOutput = `${startupAttempt.stdout || ""}\n${startupAttempt.stderr || ""}`.trim();
  const instructionCommand = detectStartupInstruction(combinedOutput);

  const result = {
    success: true,
    data: {
      startup: {
        code: startupAttempt.code,
        timedOut: startupAttempt.timedOut,
        command: `${pm2Command} startup`,
        output: combinedOutput.slice(-8000)
      },
      instructionCommand: instructionCommand || null,
      saveCommand: "pm2 save",
      hint: instructionCommand
        ? "Run the detected startup command in your server shell, then run `pm2 save`."
        : "Run `pm2 startup` in your server shell, then run `pm2 save`."
    },
    error: null
  };

  trackPm2Operation("startup", true);
  res.status(200).json(result);
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


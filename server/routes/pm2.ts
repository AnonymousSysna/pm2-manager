const os = require("os");
const fs = require("fs");
const path = require("path");
const express = require("express");
const pm2Package = require("pm2/package.json");
const { spawn } = require("child_process");
const { verifyToken } = require("../middleware/auth");
const permissionHints = require("../utils/permissionHints.js");
const withPermissionHint =
  typeof permissionHints?.withPermissionHint === "function"
    ? permissionHints.withPermissionHint
    : (message) => String(message || "Operation failed");
const { readLimiter, criticalWriteLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { trackPm2Operation } = require("../middleware/metrics");

const router = express.Router();

router.use(verifyToken);
router.use(readLimiter);

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ACTION_OUTPUT_LIMIT = 4000;
const STARTUP_OUTPUT_LIMIT = 8000;

function normalizeRunCommandOptions(timeoutOrOptions = COMMAND_TIMEOUT_MS) {
  if (typeof timeoutOrOptions === "number") {
    return {
      cwd: process.cwd(),
      timeoutMs: Number.isFinite(timeoutOrOptions)
        ? Math.max(1, Math.floor(timeoutOrOptions))
        : COMMAND_TIMEOUT_MS
    };
  }

  const options = timeoutOrOptions && typeof timeoutOrOptions === "object"
    ? timeoutOrOptions
    : {};

  return {
    cwd: options.cwd || process.cwd(),
    timeoutMs: Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1, Math.floor(Number(options.timeoutMs)))
      : COMMAND_TIMEOUT_MS
  };
}

function runCommand(command, args, timeoutOrOptions = COMMAND_TIMEOUT_MS) {
  const { cwd, timeoutMs } = normalizeRunCommandOptions(timeoutOrOptions);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
        code: typeof code === "number" ? code : -1,
        timedOut,
        stdout,
        stderr
      });
    });
  });
}

function combineOutput(stdout = "", stderr = "") {
  return `${stdout || ""}\n${stderr || ""}`.trim();
}

function truncateOutput(output = "", limit = ACTION_OUTPUT_LIMIT) {
  return String(output || "").slice(-limit);
}

function formatCommand(command, args = []) {
  return [String(command || "").trim(), ...args.map((item) => String(item || "").trim())]
    .filter(Boolean)
    .join(" ");
}

function createPm2CliInvocation(pm2Args = [], platform = process.platform) {
  return {
    executable: platform === "win32" ? "npm.cmd" : "npm",
    displayCommand: "npm",
    args: ["--prefix", "server", "exec", "pm2", "--", ...pm2Args.map((item) => String(item || "").trim())],
    cwd: REPO_ROOT
  };
}

async function runPm2Cli(pm2Args = [], options = {}) {
  const outputLimit = Number.isFinite(Number(options.outputLimit))
    ? Math.max(1, Math.floor(Number(options.outputLimit)))
    : ACTION_OUTPUT_LIMIT;
  const invocation = createPm2CliInvocation(pm2Args, options.platform);
  const commandLine = formatCommand(invocation.displayCommand, invocation.args);

  try {
    const result = await runCommand(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      timeoutMs: options.timeoutMs
    });
    const combinedOutput = combineOutput(result.stdout, result.stderr);
    return {
      ...invocation,
      commandLine,
      code: result.code,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      combinedOutput,
      output: truncateOutput(combinedOutput, outputLimit)
    };
  } catch (error) {
    const combinedOutput = String(error?.message || "Command failed").trim();
    return {
      ...invocation,
      commandLine,
      code: -1,
      timedOut: false,
      stdout: "",
      stderr: combinedOutput,
      combinedOutput,
      output: truncateOutput(combinedOutput, outputLimit)
    };
  }
}

function isCommandSuccessful(result) {
  return result?.code === 0 && result?.timedOut !== true;
}

function toActionData(result, flags = {}) {
  return {
    ...flags,
    command: result.commandLine,
    code: result.code,
    timedOut: result.timedOut,
    output: result.output
  };
}

function withPm2CliFailure(message, result) {
  return withPermissionHint(message || result?.output || "PM2 command failed", {
    command: "npm",
    args: Array.isArray(result?.args) ? result.args : []
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
    const output = combineOutput(result.stdout, result.stderr).toLowerCase();
    if (result.code === 0 && output.includes("enabled")) {
      return { supported: true, enabled: true, manager: "systemd", service, output };
    }
  }

  return { supported: true, enabled: false, manager: "systemd", service: candidates[0], output: "" };
}

router.post("/save", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const action = await runPm2Cli(["save"]);
  const success = isCommandSuccessful(action);

  trackPm2Operation("save", success);
  res.status(success ? 200 : 500).json({
    success,
    data: toActionData(action, { saved: success }),
    error: success ? null : withPm2CliFailure(action.output || "pm2 save failed", action)
  });
}));

router.post("/resurrect", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const action = await runPm2Cli(["resurrect"]);
  const success = isCommandSuccessful(action);

  trackPm2Operation("resurrect", success);
  res.status(success ? 200 : 500).json({
    success,
    data: toActionData(action, { resurrected: success }),
    error: success ? null : withPm2CliFailure(action.output || "pm2 resurrect failed", action)
  });
}));

router.post("/kill", criticalWriteLimiter, asyncHandler(async (_req, res) => {
  const action = await runPm2Cli(["kill"]);
  const success = isCommandSuccessful(action);

  trackPm2Operation("kill", success);
  res.status(success ? 200 : 500).json({
    success,
    data: toActionData(action, { killed: success }),
    error: success ? null : withPm2CliFailure(action.output || "pm2 kill failed", action)
  });
}));

router.post("/startup", criticalWriteLimiter, asyncHandler(async (_req, res) => {
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
        command: null,
        code: null,
        timedOut: false,
        output: "",
        startup: null,
        save: null,
        instructionCommand: null,
        message: "PM2 startup persistence is already enabled."
      },
      error: null
    });
    return;
  }

  const startupAttempt = await runPm2Cli(["startup"], { outputLimit: STARTUP_OUTPUT_LIMIT });
  const instructionCommand = detectStartupInstruction(startupAttempt.combinedOutput);
  const startupSuccess = isCommandSuccessful(startupAttempt);

  let saveAttempt = null;
  let saveSuccess = false;
  if (startupSuccess) {
    saveAttempt = await runPm2Cli(["save"]);
    saveSuccess = isCommandSuccessful(saveAttempt);
  }

  const postStartup = await detectStartupEnabled();
  const postDumpExists = await fileExists(dumpPath);
  const persistedNow = isStartupPersistenceVerified(postStartup, postDumpExists);

  const operationSuccess = startupSuccess && saveSuccess && persistedNow;
  trackPm2Operation("startup", operationSuccess);

  const failedAction = !startupSuccess ? startupAttempt : saveAttempt;
  const failureError = !startupSuccess
    ? instructionCommand
      ? `Startup requires elevated command: ${instructionCommand}`
      : startupAttempt.output || "pm2 startup failed"
    : !saveSuccess
      ? saveAttempt.output || "pm2 save failed"
      : "pm2 save failed or persistence check did not pass";

  res.status(operationSuccess ? 200 : 500).json({
    success: operationSuccess,
    data: {
      alreadyPersisted: false,
      activated: operationSuccess,
      startupEnabled: postStartup.enabled,
      dumpSaved: postDumpExists,
      command: startupAttempt.commandLine,
      code: startupAttempt.code,
      timedOut: startupAttempt.timedOut,
      output: startupAttempt.output,
      startup: {
        code: startupAttempt.code,
        timedOut: startupAttempt.timedOut,
        command: startupAttempt.commandLine,
        output: startupAttempt.output
      },
      save: saveAttempt
        ? {
            code: saveAttempt.code,
            timedOut: saveAttempt.timedOut,
            command: saveAttempt.commandLine,
            output: saveAttempt.output
          }
        : null,
      instructionCommand: instructionCommand || null,
      message: operationSuccess
        ? "PM2 startup persistence has been enabled."
        : "PM2 startup persistence activation failed."
    },
    error: operationSuccess ? null : withPm2CliFailure(failureError, failedAction)
  });
}));

router.get("/info", asyncHandler(async (_req, res) => {
  const action = await runPm2Cli(["jlist"]);
  const success = isCommandSuccessful(action);

  trackPm2Operation("info", success);
  res.status(success ? 200 : 500).json({
    success,
    data: success
      ? {
          pm2Version: pm2Package.version || "unknown",
          nodeVersion: process.version,
          pm2Home: getPm2HomeDir()
        }
      : null,
    error: success ? null : withPm2CliFailure(action.output || "pm2 info failed", action)
  });
}));

module.exports = router;
module.exports.runCommand = runCommand;
module.exports.createPm2CliInvocation = createPm2CliInvocation;
module.exports.runPm2Cli = runPm2Cli;
module.exports.getPm2HomeDir = getPm2HomeDir;
module.exports.detectStartupInstruction = detectStartupInstruction;
module.exports.isStartupPersistenceVerified = isStartupPersistenceVerified;

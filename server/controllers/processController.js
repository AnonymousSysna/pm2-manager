const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const pm2 = require("pm2");
const { withPM2 } = require("../utils/pm2Client");
const {
  ENV_KEY_PATTERN,
  sanitizeProcessName,
  sanitizeScriptPath,
  sanitizeEnvObject,
  resolveSafePath,
  sanitizeOptionalString,
  sanitizeNodeArgs,
  sanitizeMaxMemoryRestart,
  sanitizeInterpreter
} = require("../utils/validation");
const { trackPm2Operation } = require("../middleware/metrics");
const { appendHistoryEntry } = require("../utils/restartHistory");
const { appendDeploymentHistory, listDeploymentHistory } = require("../utils/deploymentHistory");
const { appendNotification } = require("../utils/notificationStore");
const {
  listProcessMeta,
  setProcessMeta,
  clearProcessMeta,
  exportConfig,
  importConfig
} = require("../utils/processMetaStore");
const {
  getMetricsHistory,
  getMonitoringSummary
} = require("../utils/metricsHistoryStore");

const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : DEFAULT_COMMAND_TIMEOUT_MS;
const LOG_TAIL_MAX_BYTES = Number.isFinite(Number(process.env.LOG_TAIL_MAX_BYTES))
  ? Math.max(64 * 1024, Math.floor(Number(process.env.LOG_TAIL_MAX_BYTES)))
  : 1024 * 1024;
const PROJECTS_ROOT = path.resolve(process.env.PROJECTS_ROOT || process.cwd());

function getDotEnvAllowedRoot() {
  const base = path.resolve(PROJECTS_ROOT);
  const baseName = path.basename(base).toLowerCase();
  return baseName === "apps" ? base : path.resolve(base, "apps");
}

function isPathInside(basePath, targetPath) {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function extractMissingModule(message = "") {
  const match = String(message).match(/Cannot find module ['"]([^'"]+)['"]/i);
  return match ? match[1] : "";
}

async function pathIsDirectory(targetPath) {
  try {
    const stat = await fs.promises.stat(targetPath);
    return stat.isDirectory();
  } catch (_error) {
    return false;
  }
}

async function pathIsReadableFile(targetPath) {
  try {
    await fs.promises.access(targetPath, fs.constants.R_OK);
    const stat = await fs.promises.stat(targetPath);
    return stat.isFile();
  } catch (_error) {
    return false;
  }
}

async function resolveNestedInstallDirs(projectDir, preferredAppName = "") {
  const appRoots = [path.join(projectDir, "apps"), path.join(projectDir, "packages")];
  const installDirs = [];
  const seen = new Set();

  for (const appRoot of appRoots) {
    if (!(await pathIsDirectory(appRoot))) {
      continue;
    }

    if (preferredAppName) {
      const preferredDir = path.join(appRoot, preferredAppName);
      const preferredPackageJson = path.join(preferredDir, "package.json");
      const preferredLockfile = path.join(preferredDir, "package-lock.json");
      if (
        (await pathIsReadableFile(preferredPackageJson)) &&
        (await pathIsReadableFile(preferredLockfile))
      ) {
        const resolved = path.resolve(preferredDir);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          installDirs.push(resolved);
        }
      }
    }

    const entries = await fs.promises.readdir(appRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const candidateDir = path.join(appRoot, entry.name);
      const packageJsonPath = path.join(candidateDir, "package.json");
      const lockfilePath = path.join(candidateDir, "package-lock.json");
      if (
        (await pathIsReadableFile(packageJsonPath)) &&
        (await pathIsReadableFile(lockfilePath))
      ) {
        const resolved = path.resolve(candidateDir);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          installDirs.push(resolved);
        }
      }
    }
  }

  return installDirs;
}

async function resolvePreferredNestedAppDir(projectDir, preferredAppName = "") {
  if (!preferredAppName) {
    return "";
  }
  const candidateRoots = [path.join(projectDir, "apps"), path.join(projectDir, "packages")];
  for (const root of candidateRoots) {
    const candidateDir = path.join(root, preferredAppName);
    if (!(await pathIsDirectory(candidateDir))) {
      continue;
    }
    if (await pathIsReadableFile(path.join(candidateDir, "package.json"))) {
      return path.resolve(candidateDir);
    }
  }
  return "";
}

function getNpmInstallArgs({ includeDev = false } = {}) {
  if (!includeDev) {
    return ["install"];
  }
  return ["install", "--include=dev"];
}

function runCommand(command, args, cwd) {
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
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(
          new Error(
            `Command timed out after ${COMMAND_TIMEOUT_MS}ms (${command} ${args.join(" ")})`
          )
        );
        return;
      }

      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed (${command} ${args.join(" ")}), exit code ${code}${
            stderr ? `: ${stderr.trim()}` : ""
          }`
        )
      );
    });
  });
}

async function directoryIsEmpty(targetPath) {
  try {
    const entries = await fs.promises.readdir(targetPath);
    return entries.length === 0;
  } catch (_error) {
    return false;
  }
}

function compactOutput(output = "") {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join("\n")
    .slice(-2000);
}

async function recordOperationNotification({
  category = "operation",
  level = "info",
  title = "PM2 operation",
  message = "",
  processName = null,
  details = null
}) {
  try {
    await appendNotification({
      category,
      level,
      title,
      message,
      processName,
      details
    });
  } catch (_error) {
    // Best-effort notification append.
  }
}

function describeProcess(name) {
  return new Promise((resolve, reject) => {
    pm2.describe(name, (error, description) => {
      if (error) {
        reject(error);
        return;
      }
      const proc = Array.isArray(description) ? description[0] : null;
      resolve(proc || null);
    });
  });
}

async function resolveProcessWorkingDirectory(processName) {
  const proc = await describeProcess(processName);
  if (!proc) {
    throw new Error(`Process not found: ${processName}`);
  }

  const cwd = proc.pm2_env?.pm_cwd;
  let cwdStat;
  try {
    cwdStat = await fs.promises.stat(cwd);
  } catch (_error) {
    cwdStat = null;
  }

  if (!cwd || !cwdStat || !cwdStat.isDirectory()) {
    throw new Error(`Cannot resolve process working directory for: ${processName}`);
  }

  return { proc, cwd: path.resolve(cwd) };
}

async function resolveDotEnvEditableDirectory(processName) {
  const { proc, cwd } = await resolveProcessWorkingDirectory(processName);
  const allowedRoot = getDotEnvAllowedRoot();
  if (!isPathInside(allowedRoot, cwd)) {
    throw new Error(`.env editing is restricted to ${allowedRoot}`);
  }
  return { proc, cwd, allowedRoot };
}

function findPort(env = {}) {
  return env.PORT || env.port || env.PM2_PORT || null;
}

function formatUptime(proc) {
  const pm2Env = proc.pm2_env || {};
  if (!pm2Env.pm_uptime) {
    return 0;
  }
  return Date.now() - pm2Env.pm_uptime;
}

function formatProcess(proc) {
  const monit = proc.monit || {};
  const pm2Env = proc.pm2_env || {};
  const env = pm2Env.env || {};

  const rawMode = pm2Env.exec_mode || "fork";
  const mode = rawMode.includes("cluster") ? "cluster" : "fork";

  return {
    id: proc.pm_id,
    name: proc.name,
    cwd: pm2Env.pm_cwd || "",
    pid: proc.pid,
    status: pm2Env.status || "unknown",
    cpu: monit.cpu || 0,
    memory: monit.memory || 0,
    uptime: formatUptime(proc),
    restarts: pm2Env.restart_time || 0,
    port: findPort(env),
    mode
  };
}

async function listProcesses() {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.list((error, processes) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(processes.map(formatProcess));
        });
      })
  );
  trackPm2Operation("processes.list", result.success);
  return result;
}

async function startProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.start(processName, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
  trackPm2Operation("processes.start", result.success);
  if (result.success) {
    try {
      await appendHistoryEntry({
        processName,
        event: "start",
        source: "api"
      });
    } catch (_error) {
      // Best-effort audit append: do not fail start operation.
    }
    await recordOperationNotification({
      category: "operation",
      title: `${processName} started`,
      message: `Start operation completed for ${processName}`,
      processName
    });
  }
  return result;
}

async function stopProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.stop(processName, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
  trackPm2Operation("processes.stop", result.success);
  if (result.success) {
    await recordOperationNotification({
      category: "operation",
      title: `${processName} stopped`,
      message: `Stop operation completed for ${processName}`,
      processName
    });
  }
  return result;
}

async function restartProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.restart(processName, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
  trackPm2Operation("processes.restart", result.success);
  if (result.success) {
    try {
      await appendHistoryEntry({
        processName,
        event: "restart",
        source: "api"
      });
    } catch (_error) {
      // Best-effort audit append: do not fail restart operation.
    }
    await recordOperationNotification({
      category: "operation",
      title: `${processName} restarted`,
      message: `Restart operation completed for ${processName}`,
      processName
    });
  }
  return result;
}

async function runBulkAction(action, names = []) {
  const safeAction = String(action || "").trim().toLowerCase();
  const allowed = new Set(["start", "stop", "restart"]);
  if (!allowed.has(safeAction)) {
    return {
      success: false,
      data: null,
      error: `Unsupported bulk action: ${safeAction}`
    };
  }

  if (!Array.isArray(names) || names.length === 0) {
    return {
      success: false,
      data: null,
      error: "names must be a non-empty array"
    };
  }

  const uniqueNames = [...new Set(names.map((name) => sanitizeProcessName(name, "process name")))];
  const handler = {
    start: startProcess,
    stop: stopProcess,
    restart: restartProcess
  }[safeAction];

  const results = [];
  for (const processName of uniqueNames) {
    const result = await handler(processName);
    results.push({
      name: processName,
      success: Boolean(result?.success),
      error: result?.success ? null : result?.error || `Failed to ${safeAction}`
    });
  }

  const successCount = results.filter((item) => item.success).length;
  const failedCount = results.length - successCount;
  return {
    success: failedCount === 0,
    data: {
      action: safeAction,
      total: results.length,
      successCount,
      failedCount,
      results
    },
    error: failedCount === 0 ? null : `${failedCount} process action(s) failed`
  };
}

function inferDotEnvValueType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "false") {
    return "boolean";
  }
  if (/^[+-]?\d+$/.test(String(value ?? "").trim())) {
    return "integer";
  }
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(String(value ?? "").trim())) {
    return "number";
  }
  return "string";
}

function parseDotEnvContent(content = "") {
  const raw = String(content ?? "");
  const lines = raw.split(/\r?\n/);
  const parsedLines = [];
  const entries = [];

  lines.forEach((line, index) => {
    const pairMatch = line.match(/^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!pairMatch) {
      parsedLines.push({ type: "raw", line });
      return;
    }

    const exportedPrefix = pairMatch[1] ? "export " : "";
    const key = pairMatch[2];
    const value = pairMatch[3] ?? "";
    parsedLines.push({
      type: "pair",
      key,
      value,
      exportedPrefix
    });
    entries.push({
      index,
      key,
      value,
      valueType: inferDotEnvValueType(value)
    });
  });

  return { lines: parsedLines, entries };
}

async function updateProcessEnv(name, envPatch = {}, options = {}) {
  const processName = sanitizeProcessName(name, "process name");
  const replace = Boolean(options?.replace);
  const safePatch = sanitizeEnvObject(envPatch || {});

  const result = await withPM2(async () => {
    const proc = await describeProcess(processName);
    if (!proc) {
      throw new Error(`Process not found: ${processName}`);
    }

    const currentEnv = sanitizeEnvObject(proc.pm2_env?.env || {});
    const nextEnv = replace ? safePatch : { ...currentEnv, ...safePatch };

    await new Promise((resolve, reject) => {
      pm2.restart(
        {
          name: processName,
          updateEnv: true,
          env: nextEnv
        },
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
    });

    return {
      name: processName,
      replace,
      keys: Object.keys(safePatch),
      env: nextEnv
    };
  });

  trackPm2Operation("processes.env.update", result.success);
  if (result.success) {
    await recordOperationNotification({
      category: "operation",
      title: `${processName} env updated`,
      message: `Environment variables updated and process restarted`,
      processName,
      details: {
        updatedKeys: result.data.keys,
        replace
      }
    });
  }
  return result;
}

async function readProcessDotEnv(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(async () => {
    const { cwd, allowedRoot } = await resolveDotEnvEditableDirectory(processName);
    const envPath = path.join(cwd, ".env");

    let hasEnvFile = false;
    try {
      await fs.promises.access(envPath, fs.constants.R_OK);
      hasEnvFile = true;
    } catch (_error) {
      hasEnvFile = false;
    }

    if (!hasEnvFile) {
      return {
        processName,
        cwd,
        allowedRoot,
        envPath,
        hasEnvFile: false,
        entries: []
      };
    }

    const content = await fs.promises.readFile(envPath, "utf8");
    const parsed = parseDotEnvContent(content);
    return {
      processName,
      cwd,
      allowedRoot,
      envPath,
      hasEnvFile: true,
      entries: parsed.entries
    };
  });
  trackPm2Operation("processes.dotenv.read", result.success);
  return result;
}

async function updateProcessDotEnv(name, payload = {}) {
  const processName = sanitizeProcessName(name, "process name");
  const valuesRaw = payload?.values || {};
  if (!valuesRaw || typeof valuesRaw !== "object" || Array.isArray(valuesRaw)) {
    return { success: false, data: null, error: "values must be an object" };
  }

  const values = {};
  for (const [rawKey, rawValue] of Object.entries(valuesRaw)) {
    const key = String(rawKey || "").trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      return { success: false, data: null, error: `Invalid environment variable name: ${rawKey}` };
    }
    values[key] = String(rawValue ?? "");
  }

  const result = await withPM2(async () => {
    const { cwd, allowedRoot } = await resolveDotEnvEditableDirectory(processName);
    const envPath = path.join(cwd, ".env");

    try {
      await fs.promises.access(envPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (_error) {
      throw new Error(`.env file not found or not writable for ${processName}`);
    }

    const content = await fs.promises.readFile(envPath, "utf8");
    const parsed = parseDotEnvContent(content);

    let updatedCount = 0;
    const nextLines = parsed.lines.map((line) => {
      if (line.type !== "pair") {
        return line.line;
      }
      if (!Object.prototype.hasOwnProperty.call(values, line.key)) {
        return `${line.exportedPrefix}${line.key}=${line.value}`;
      }
      updatedCount += 1;
      return `${line.exportedPrefix}${line.key}=${values[line.key]}`;
    });

    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    await fs.promises.writeFile(envPath, nextLines.join(eol), "utf8");

    const nextParsed = parseDotEnvContent(nextLines.join(eol));
    return {
      processName,
      cwd,
      allowedRoot,
      envPath,
      hasEnvFile: true,
      updatedCount,
      entries: nextParsed.entries
    };
  });

  trackPm2Operation("processes.dotenv.update", result.success);
  if (result.success) {
    await recordOperationNotification({
      category: "operation",
      title: `${processName} .env updated`,
      message: `.env file updated for ${processName}`,
      processName,
      details: {
        updatedKeys: Object.keys(values),
        updatedCount: result.data.updatedCount
      }
    });
  }
  return result;
}

async function deleteProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.delete(processName, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
  trackPm2Operation("processes.delete", result.success);
  if (result.success) {
    await recordOperationNotification({
      category: "operation",
      level: "warning",
      title: `${processName} deleted`,
      message: `Delete operation completed for ${processName}`,
      processName
    });
  }
  return result;
}

async function createProcess(config) {
  const result = await withPM2(async () => {
    const {
      name,
      script,
      port,
      instances,
      exec_mode,
      env,
      cwd,
      watch,
      args,
      max_memory_restart,
      node_args,
      interpreter,
      log_date_format,
      project_path,
      git_clone_url,
      git_branch,
      env_file_content,
      install_dependencies,
      run_build,
      start_script
    } = config;

    const safeName = sanitizeProcessName(name, "process name");
    const rawScript = String(script || "").trim();
    const rawCwd = String(cwd || "").trim();
    let normalizedScript = rawScript ? sanitizeScriptPath(rawScript) : "";
    let normalizedCwd = rawCwd ? path.resolve(rawCwd) : process.cwd();

    // Allow users to paste a full absolute path and infer cwd automatically.
    if (normalizedScript && path.isAbsolute(normalizedScript)) {
      normalizedScript = path.basename(normalizedScript);
      if (!cwd) {
        normalizedCwd = path.dirname(path.resolve(rawScript));
      }
    }

    let finalScript = normalizedScript;
    let finalArgs = args;
    let finalCwd = normalizedCwd;

    const projectPathInput = String(project_path || "").trim();
    if (projectPathInput) {
      const projectDir = resolveSafePath(projectPathInput, PROJECTS_ROOT, "project_path");
      const packageJsonPath = path.join(projectDir, "package.json");
      const cloneUrl = String(git_clone_url || "").trim();
      const cloneBranch = String(git_branch || "").trim();

      let projectStat;
      try {
        projectStat = await fs.promises.stat(projectDir);
      } catch (_error) {
        projectStat = null;
      }

      if (cloneUrl) {
        const gitUrl = sanitizeOptionalString(cloneUrl, "git_clone_url", 2048);
        if (!gitUrl) {
          throw new Error("git_clone_url is required when provided");
        }

        if (!projectStat) {
          await fs.promises.mkdir(projectDir, { recursive: true });
          projectStat = await fs.promises.stat(projectDir);
        }

        if (!projectStat.isDirectory()) {
          throw new Error(`Project path is not a directory: ${projectDir}`);
        }

        if (!(await directoryIsEmpty(projectDir))) {
          throw new Error(`Project path must be empty before git clone: ${projectDir}`);
        }

        const cloneArgs = ["clone"];
        if (cloneBranch) {
          cloneArgs.push("--branch", cloneBranch, "--single-branch");
        }
        cloneArgs.push(gitUrl, projectDir);
        await runCommand("git", cloneArgs, PROJECTS_ROOT);

        projectStat = await fs.promises.stat(projectDir);
      }

      if (!projectStat || !projectStat.isDirectory()) {
        throw new Error(`Project path does not exist or is not a directory: ${projectDir}`);
      }

      if (env_file_content !== undefined && env_file_content !== null) {
        const envFile = String(env_file_content);
        await fs.promises.writeFile(path.join(projectDir, ".env"), envFile, "utf8");
      }

      try {
        await fs.promises.access(packageJsonPath, fs.constants.R_OK);
      } catch (_error) {
        throw new Error(`package.json not found at: ${packageJsonPath}`);
      }

      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf8"));
      const scripts = packageJson.scripts || {};
      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
      const startScriptName = String(start_script || "start").trim() || "start";

      if (install_dependencies) {
        const installArgs = getNpmInstallArgs({ includeDev: Boolean(run_build) });
        await runCommand(npmCmd, installArgs, projectDir);
        const nestedInstallDirs = await resolveNestedInstallDirs(projectDir, safeName);
        for (const installDir of nestedInstallDirs) {
          await runCommand(npmCmd, installArgs, installDir);
        }
      }

      if (run_build) {
        if (!scripts.build) {
          throw new Error(`Missing "build" script in ${packageJsonPath}`);
        }
        try {
          await runCommand(npmCmd, ["run", "build"], projectDir);
        } catch (error) {
          const missingModule = extractMissingModule(error?.message || "");
          if (missingModule) {
            if (install_dependencies) {
              const preferredNestedDir = await resolvePreferredNestedAppDir(projectDir, safeName);
              const installTargetDir = preferredNestedDir || projectDir;
              try {
                await runCommand(
                  npmCmd,
                  ["install", "--include=dev", "--save-dev", missingModule],
                  installTargetDir
                );
                await runCommand(npmCmd, ["run", "build"], projectDir);
              } catch (_retryError) {
                throw new Error(
                  `${error.message}\nHint: missing dependency "${missingModule}". Auto-install + retry failed in ${installTargetDir}.`
                );
              }
            } else {
              throw new Error(
                `${error.message}\nHint: missing dependency "${missingModule}". If this is a nested app (for example apps/${safeName}), run npm install in that app directory or enable "Run npm install before start".`
              );
            }
            return;
          }
          throw error;
        }
      }

      if (!scripts[startScriptName]) {
        throw new Error(`Missing "${startScriptName}" script in ${packageJsonPath}`);
      }

      finalScript = npmCmd;
      finalArgs = `run ${startScriptName}`;
      finalCwd = projectDir;
    }

    if (!finalScript || !String(finalScript).trim()) {
      throw new Error("Script path is required");
    }
    const safeScript = sanitizeScriptPath(finalScript);
    const safeEnv = sanitizeEnvObject(env);
    const safeCwd = resolveSafePath(String(finalCwd || process.cwd()), PROJECTS_ROOT, "cwd");

    const parsedInstances = Number(instances || 1);
    const safeInstances = Number.isFinite(parsedInstances)
      ? Math.min(64, Math.max(1, Math.floor(parsedInstances)))
      : 1;

    const incomingMode = String(exec_mode || "fork").trim();
    const safeExecMode =
      incomingMode === "cluster" || incomingMode === "cluster_mode" ? "cluster" : "fork";

    const processConfig = {
      name: safeName,
      script: safeScript,
      args: sanitizeOptionalString(finalArgs, "args", 1024),
      instances: safeInstances,
      exec_mode: safeExecMode,
      cwd: safeCwd,
      watch: Boolean(watch),
      env: {
        ...safeEnv,
        ...(port ? { PORT: String(port) } : {})
      },
      max_memory_restart: sanitizeMaxMemoryRestart(max_memory_restart),
      node_args: sanitizeNodeArgs(node_args),
      interpreter: sanitizeInterpreter(interpreter),
      log_date_format: sanitizeOptionalString(log_date_format, "log_date_format", 128)
    };

    return new Promise((resolve, reject) => {
      pm2.start(processConfig, (error, proc) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(proc);
      });
    });
  });
  trackPm2Operation("processes.create", result.success);
  if (result.success) {
    const processName = sanitizeProcessName(config?.name, "process name");
    await recordOperationNotification({
      category: "operation",
      title: `${processName} created`,
      message: `Create operation completed for ${processName}`,
      processName
    });
  }
  return result;
}

async function getProcessLogs(name, lines = 100) {
  const processName = sanitizeProcessName(name, "process name");

  const readTail = async (filePath) => {
    if (!filePath) {
      return [];
    }

    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch (_error) {
      return [];
    }

    if (!stat.isFile()) {
      return [];
    }

    const bytes = Math.min(LOG_TAIL_MAX_BYTES, stat.size);
    const start = Math.max(0, stat.size - bytes);

    const fd = await fs.promises.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const result = await fd.read(buffer, 0, bytes, start);
      const text = buffer.slice(0, result.bytesRead).toString("utf8");
      return text
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-Number(lines));
    } finally {
      await fd.close();
    }
  };

  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        describeProcess(processName)
          .then((proc) => {
            if (!proc) {
              resolve({ stdout: [], stderr: [] });
              return;
            }

            const env = proc.pm2_env || {};
            const stdoutPath = env.pm_out_log_path;
            const stderrPath = env.pm_err_log_path;

            Promise.all([readTail(stdoutPath), readTail(stderrPath)])
              .then(([stdout, stderr]) => {
                resolve({
                  stdout,
                  stderr,
                  paths: {
                    stdout: stdoutPath ? path.resolve(stdoutPath) : null,
                    stderr: stderrPath ? path.resolve(stderrPath) : null
                  }
                });
              })
              .catch(reject);
          })
          .catch(reject);
      })
  );
  trackPm2Operation("processes.logs", result.success);
  return result;
}

async function reloadProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.reload(processName, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
  trackPm2Operation("processes.reload", result.success);
  if (result.success) {
    try {
      await appendHistoryEntry({
        processName,
        event: "reload",
        source: "api"
      });
    } catch (_error) {
      // Best-effort audit append: do not fail reload operation.
    }
    await recordOperationNotification({
      category: "operation",
      title: `${processName} reloaded`,
      message: `Reload operation completed for ${processName}`,
      processName
    });
  }
  return result;
}

async function flushLogs(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.flush(processName, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ name: processName, flushed: true });
        });
      })
  );
  trackPm2Operation("processes.flush", result.success);
  return result;
}

async function getProcessDetails(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(() => describeProcess(processName));
  trackPm2Operation("processes.details", result.success);
  return result;
}

async function runNpmScriptForProcess(name, scriptName, args = []) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(async () => {
    const proc = await describeProcess(processName);
    if (!proc) {
      throw new Error(`Process not found: ${processName}`);
    }

    const cwd = proc.pm2_env?.pm_cwd;
    let cwdStat;
    try {
      cwdStat = await fs.promises.stat(cwd);
    } catch (_error) {
      cwdStat = null;
    }

    if (!cwd || !cwdStat || !cwdStat.isDirectory()) {
      throw new Error(`Cannot resolve process working directory for: ${processName}`);
    }

    const packageJsonPath = path.join(cwd, "package.json");
    try {
      await fs.promises.access(packageJsonPath, fs.constants.R_OK);
    } catch (_error) {
      throw new Error(`No package.json found in process directory: ${cwd}`);
    }

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

    if (scriptName === "install") {
      const result = await runCommand(
        npmCmd,
        [...getNpmInstallArgs({ includeDev: true }), ...args],
        cwd
      );
      return { command: "npm install", cwd, output: result.stdout.slice(-4000) };
    }

    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf8"));
    const scripts = packageJson.scripts || {};
    if (!scripts[scriptName]) {
      throw new Error(`Script "${scriptName}" not found in ${packageJsonPath}`);
    }

    const result = await runCommand(npmCmd, ["run", scriptName, ...args], cwd);
    return { command: `npm run ${scriptName}`, cwd, output: result.stdout.slice(-4000) };
  });
  trackPm2Operation(`processes.npm.${scriptName}`, result.success);
  return result;
}

async function npmInstall(name) {
  return runNpmScriptForProcess(name, "install");
}

async function npmBuild(name) {
  return runNpmScriptForProcess(name, "build");
}

async function deployProcess(name, options = {}, actor = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const branch = String(options.branch || "").trim();
  const installDependencies = options.installDependencies !== false;
  const runBuild = options.runBuild !== false;
  const restartMode = String(options.restartMode || "restart").trim() === "reload" ? "reload" : "restart";
  const gitRemote = String(options.gitRemote || "origin").trim() || "origin";

  const result = await withPM2(async () => {
    const proc = await describeProcess(processName);
    if (!proc) {
      throw new Error(`Process not found: ${processName}`);
    }

    const cwd = proc.pm2_env?.pm_cwd;
    let cwdStat;
    try {
      cwdStat = await fs.promises.stat(cwd);
    } catch (_error) {
      cwdStat = null;
    }

    if (!cwd || !cwdStat || !cwdStat.isDirectory()) {
      throw new Error(`Cannot resolve process working directory for: ${processName}`);
    }

    const steps = [];
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

    const runStep = async (label, command, args) => {
      const startedAt = Date.now();
      try {
        const output = await runCommand(command, args, cwd);
        steps.push({
          label,
          success: true,
          durationMs: Date.now() - startedAt,
          output: String(output.stdout || output.stderr || "").slice(-4000)
        });
      } catch (error) {
        steps.push({
          label,
          success: false,
          durationMs: Date.now() - startedAt,
          error: error.message
        });
        throw error;
      }
    };

    await runStep("git:check", "git", ["rev-parse", "--is-inside-work-tree"]);
    await runStep("git:fetch", "git", ["fetch", gitRemote, "--prune"]);

    if (branch) {
      await runStep("git:checkout", "git", ["checkout", branch]);
      await runStep("git:pull", "git", ["pull", "--ff-only", gitRemote, branch]);
    } else {
      await runStep("git:pull", "git", ["pull", "--ff-only"]);
    }

    if (installDependencies) {
      await runStep("npm:install", npmCmd, getNpmInstallArgs({ includeDev: runBuild }));
    }

    if (runBuild) {
      await runStep("npm:build", npmCmd, ["run", "build"]);
    }

    if (restartMode === "reload") {
      await new Promise((resolve, reject) => {
        pm2.reload(processName, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      steps.push({ label: "pm2:reload", success: true, durationMs: 0, output: "Process reloaded" });
    } else {
      await new Promise((resolve, reject) => {
        pm2.restart(processName, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      steps.push({ label: "pm2:restart", success: true, durationMs: 0, output: "Process restarted" });
    }

    return {
      processName,
      cwd,
      branch: branch || null,
      installDependencies,
      runBuild,
      restartMode,
      steps
    };
  });

  trackPm2Operation("processes.deploy", result.success);
  await appendDeploymentHistory({
    processName,
    actor,
    success: result.success,
    branch: branch || null,
    installDependencies,
    runBuild,
    restartMode,
    steps: result.success ? result.data.steps : [],
    error: result.success ? null : result.error
  }).catch(() => {
    // Best-effort audit append.
  });

  await recordOperationNotification({
    category: "deployment",
    level: result.success ? "info" : "danger",
    title: result.success ? `${processName} deployed` : `${processName} deployment failed`,
    message: result.success
      ? `Deploy completed${branch ? ` on ${branch}` : ""}`
      : `Deploy failed: ${result.error || "unknown error"}`,
    processName,
    details: result.success
      ? {
          branch: branch || null,
          steps: result.data.steps.map((step) => ({
            label: step.label,
            success: step.success,
            durationMs: step.durationMs
          }))
        }
      : { error: result.error }
  });

  return result;
}

async function getDeploymentHistory(limit = 100, processName = "") {
  const history = await listDeploymentHistory(limit, processName);
  return { success: true, data: history, error: null };
}

async function getGitCommitsForProcess(name, limit = 20) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(async () => {
    const proc = await describeProcess(processName);
    if (!proc) {
      throw new Error(`Process not found: ${processName}`);
    }

    const cwd = proc.pm2_env?.pm_cwd;
    let cwdStat;
    try {
      cwdStat = await fs.promises.stat(cwd);
    } catch (_error) {
      cwdStat = null;
    }
    if (!cwd || !cwdStat || !cwdStat.isDirectory()) {
      throw new Error(`Cannot resolve process working directory for: ${processName}`);
    }

    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    await runCommand("git", ["rev-parse", "--is-inside-work-tree"], cwd);
    const output = await runCommand(
      "git",
      ["log", `-n${normalizedLimit}`, "--date=iso-strict", "--pretty=format:%H|%h|%ad|%an|%s"],
      cwd
    );

    const commits = String(output.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, author, ...subjectParts] = line.split("|");
        return {
          hash,
          shortHash,
          date,
          author,
          subject: subjectParts.join("|")
        };
      });
    return { processName, cwd, commits };
  });

  trackPm2Operation("processes.git.commits", result.success);
  return result;
}

async function readGitStatusForDirectory(processName, cwd) {
  try {
    await runCommand("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  } catch (_error) {
    return {
      processName,
      cwd,
      isGitRepo: false,
      branch: null,
      localCommit: null,
      upstream: null,
      upstreamCommit: null,
      ahead: 0,
      behind: 0,
      upToDate: false,
      cleanWorkingTree: null
    };
  }

  const branchOutput = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const localOutput = await runCommand("git", ["rev-parse", "HEAD"], cwd);
  const shortLocalOutput = await runCommand("git", ["rev-parse", "--short", "HEAD"], cwd);
  const statusOutput = await runCommand("git", ["status", "--porcelain"], cwd);

  let upstream = "";
  try {
    const upstreamOutput = await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd);
    upstream = String(upstreamOutput.stdout || "").trim();
  } catch (_error) {
    upstream = "";
  }

  let ahead = 0;
  let behind = 0;
  let upstreamCommit = "";
  if (upstream) {
    await runCommand("git", ["fetch", "--prune"], cwd);
    const countsOutput = await runCommand("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], cwd);
    const [behindRaw, aheadRaw] = String(countsOutput.stdout || "").trim().split(/\s+/);
    behind = Math.max(0, Number(behindRaw) || 0);
    ahead = Math.max(0, Number(aheadRaw) || 0);
    const upstreamHeadOutput = await runCommand("git", ["rev-parse", "--short", upstream], cwd);
    upstreamCommit = String(upstreamHeadOutput.stdout || "").trim();
  }

  return {
    processName,
    cwd,
    isGitRepo: true,
    branch: String(branchOutput.stdout || "").trim() || null,
    localCommit: String(localOutput.stdout || "").trim() || null,
    localShortCommit: String(shortLocalOutput.stdout || "").trim() || null,
    upstream: upstream || null,
    upstreamCommit: upstreamCommit || null,
    ahead,
    behind,
    upToDate: Boolean(upstream) && ahead === 0 && behind === 0,
    cleanWorkingTree: String(statusOutput.stdout || "").trim().length === 0
  };
}

async function getGitStatusForProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(async () => {
    const { cwd } = await resolveProcessWorkingDirectory(processName);
    return readGitStatusForDirectory(processName, cwd);
  });
  trackPm2Operation("processes.git.status", result.success);
  return result;
}

async function gitPullProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(async () => {
    const { cwd } = await resolveProcessWorkingDirectory(processName);
    const gitStatus = await readGitStatusForDirectory(processName, cwd);
    if (!gitStatus.isGitRepo) {
      throw new Error(`Process ${processName} is not in a Git repository`);
    }
    if (!gitStatus.upstream) {
      throw new Error(`No upstream tracking branch configured for ${processName}`);
    }
    if (Number(gitStatus.behind || 0) <= 0) {
      throw new Error(`No new remote commits to pull for ${processName}`);
    }

    await runCommand("git", ["fetch", "--prune"], gitStatus.cwd);
    await runCommand("git", ["pull", "--ff-only"], gitStatus.cwd);

    const afterStatusResult = await readGitStatusForDirectory(processName, gitStatus.cwd);
    return {
      processName,
      statusBefore: gitStatus,
      statusAfter: afterStatusResult
    };
  });

  trackPm2Operation("processes.git.pull", result.success);
  return result;
}

async function rollbackProcess(name, options = {}, actor = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const targetCommit = String(options.targetCommit || "").trim();
  const restartMode = String(options.restartMode || "restart").trim() === "reload" ? "reload" : "restart";

  const result = await withPM2(async () => {
    const proc = await describeProcess(processName);
    if (!proc) {
      throw new Error(`Process not found: ${processName}`);
    }

    const cwd = proc.pm2_env?.pm_cwd;
    let cwdStat;
    try {
      cwdStat = await fs.promises.stat(cwd);
    } catch (_error) {
      cwdStat = null;
    }
    if (!cwd || !cwdStat || !cwdStat.isDirectory()) {
      throw new Error(`Cannot resolve process working directory for: ${processName}`);
    }

    const steps = [];
    const runStep = async (label, command, args) => {
      const startedAt = Date.now();
      try {
        const output = await runCommand(command, args, cwd);
        steps.push({
          label,
          success: true,
          durationMs: Date.now() - startedAt,
          output: compactOutput(output.stdout || output.stderr || "")
        });
        return output;
      } catch (error) {
        steps.push({
          label,
          success: false,
          durationMs: Date.now() - startedAt,
          error: error.message
        });
        throw error;
      }
    };

    await runStep("git:check", "git", ["rev-parse", "--is-inside-work-tree"]);
    const currentHead = await runStep("git:head", "git", ["rev-parse", "HEAD"]);

    let resolvedTarget = targetCommit;
    if (!resolvedTarget) {
      const previousHead = await runStep("git:previous-head", "git", ["rev-parse", "HEAD~1"]);
      resolvedTarget = String(previousHead.stdout || "").trim();
    } else {
      await runStep("git:verify-target", "git", ["rev-parse", "--verify", resolvedTarget]);
    }

    await runStep("git:reset", "git", ["reset", "--hard", resolvedTarget]);

    if (restartMode === "reload") {
      await new Promise((resolve, reject) => {
        pm2.reload(processName, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      steps.push({ label: "pm2:reload", success: true, durationMs: 0, output: "Process reloaded" });
    } else {
      await new Promise((resolve, reject) => {
        pm2.restart(processName, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      steps.push({ label: "pm2:restart", success: true, durationMs: 0, output: "Process restarted" });
    }

    return {
      processName,
      cwd,
      fromCommit: String(currentHead.stdout || "").trim(),
      toCommit: resolvedTarget,
      restartMode,
      steps
    };
  });

  trackPm2Operation("processes.rollback", result.success);
  await appendDeploymentHistory({
    processName,
    actor,
    success: result.success,
    branch: null,
    installDependencies: false,
    runBuild: false,
    restartMode,
    action: "rollback",
    targetCommit: targetCommit || null,
    steps: result.success ? result.data.steps : [],
    error: result.success ? null : result.error
  }).catch(() => {
    // Best-effort audit append.
  });

  await recordOperationNotification({
    category: "deployment",
    level: result.success ? "warning" : "danger",
    title: result.success ? `${processName} rolled back` : `${processName} rollback failed`,
    message: result.success
      ? `Rollback completed to ${result.data.toCommit.slice(0, 8)}`
      : `Rollback failed: ${result.error || "unknown error"}`,
    processName,
    details: result.success ? result.data : { error: result.error, actor, targetCommit }
  });

  return result;
}

async function getProcessCatalog() {
  const [live, processMeta] = await Promise.all([listProcesses(), listProcessMeta()]);

  if (!live.success) {
    return live;
  }

  const withMeta = await Promise.all(live.data.map(async (proc) => {
    const meta = processMeta[proc.name] || {
      group: "",
      dependencies: [],
      alertThresholds: { cpu: null, memoryMB: null }
    };
    const cwd = String(proc?.cwd || "").trim();
    const allowedRoot = getDotEnvAllowedRoot();
    const hasDotEnvFile = cwd && isPathInside(allowedRoot, cwd)
      ? await pathIsReadableFile(path.join(cwd, ".env"))
      : false;

    return {
      ...proc,
      meta,
      hasDotEnvFile
    };
  }));

  return {
    success: true,
    data: {
      processes: withMeta,
      meta: processMeta
    },
    error: null
  };
}

async function updateProcessMetadata(name, payload) {
  const nextMeta = await setProcessMeta(name, payload || {});
  return {
    success: true,
    data: nextMeta,
    error: null
  };
}

async function removeProcessMetadata(name) {
  await clearProcessMeta(name);
  return { success: true, data: { removed: true }, error: null };
}

async function readProcessMetrics(name, limit) {
  const points = await getMetricsHistory(name, limit);
  return { success: true, data: points, error: null };
}

async function readMonitoringSummary() {
  const live = await listProcesses();
  if (!live.success) {
    return live;
  }
  const summary = await getMonitoringSummary(live.data);
  return { success: true, data: summary, error: null };
}

async function exportProcessConfig() {
  const payload = await exportConfig();
  return { success: true, data: payload, error: null };
}

async function importProcessConfig(payload) {
  const result = await importConfig(payload || {});
  return { success: true, data: result, error: null };
}

module.exports = {
  listProcesses,
  getProcessCatalog,
  startProcess,
  stopProcess,
  restartProcess,
  runBulkAction,
  updateProcessEnv,
  deleteProcess,
  createProcess,
  getProcessLogs,
  reloadProcess,
  flushLogs,
  getProcessDetails,
  npmInstall,
  npmBuild,
  updateProcessMetadata,
  removeProcessMetadata,
  readProcessMetrics,
  readMonitoringSummary,
  exportProcessConfig,
  importProcessConfig,
  deployProcess,
  getDeploymentHistory,
  getGitCommitsForProcess,
  getGitStatusForProcess,
  gitPullProcess,
  rollbackProcess,
  readProcessDotEnv,
  updateProcessDotEnv
};

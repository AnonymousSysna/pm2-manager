const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const pm2 = require("pm2");
const { withPM2 } = require("../utils/pm2Client");
const {
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
const {
  listProcessMeta,
  setProcessMeta,
  clearProcessMeta,
  listGroups,
  setGroup,
  getGroupMembers,
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

      let projectStat;
      try {
        projectStat = await fs.promises.stat(projectDir);
      } catch (_error) {
        projectStat = null;
      }

      if (!projectStat || !projectStat.isDirectory()) {
        throw new Error(`Project path does not exist or is not a directory: ${projectDir}`);
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
        await runCommand(npmCmd, ["install"], projectDir);
        const nestedInstallDirs = await resolveNestedInstallDirs(projectDir, safeName);
        for (const installDir of nestedInstallDirs) {
          await runCommand(npmCmd, ["install"], installDir);
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
            throw new Error(
              `${error.message}\nHint: missing dependency "${missingModule}". If this is a nested app (for example apps/${safeName}), run npm install in that app directory or enable "Run npm install before start".`
            );
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
      const result = await runCommand(npmCmd, ["install", ...args], cwd);
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
      await runStep("npm:install", npmCmd, ["install"]);
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

  return result;
}

async function getDeploymentHistory(limit = 100, processName = "") {
  const history = await listDeploymentHistory(limit, processName);
  return { success: true, data: history, error: null };
}

function buildDependencyOrder(targetNames, processMeta) {
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  const visit = (name) => {
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`Dependency cycle detected at process: ${name}`);
    }

    visiting.add(name);
    const dependencies = processMeta[name]?.dependencies || [];
    for (const dep of dependencies) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };

  for (const name of targetNames) {
    visit(name);
  }

  return ordered;
}

async function getProcessCatalog() {
  const [live, processMeta, groups] = await Promise.all([
    listProcesses(),
    listProcessMeta(),
    listGroups()
  ]);

  if (!live.success) {
    return live;
  }

  const withMeta = live.data.map((proc) => {
    const meta = processMeta[proc.name] || {
      group: "",
      tags: [],
      dependencies: [],
      alertThresholds: { cpu: null, memoryMB: null }
    };

    return {
      ...proc,
      meta
    };
  });

  return {
    success: true,
    data: {
      processes: withMeta,
      groups,
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

async function updateGroupMembers(groupName, members) {
  const group = await setGroup(groupName, members || []);
  return { success: true, data: group, error: null };
}

async function runBulkGroupAction(groupName, actionName) {
  const groupMembers = await getGroupMembers(groupName);
  if (!Array.isArray(groupMembers) || groupMembers.length === 0) {
    throw new Error(`Group is empty or not found: ${groupName}`);
  }

  const processMeta = await listProcessMeta();
  const ordered = buildDependencyOrder(groupMembers, processMeta);
  const targetList = actionName === "start" ? ordered : [...ordered].reverse();

  const handlers = {
    start: startProcess,
    stop: stopProcess,
    restart: restartProcess
  };
  const handler = handlers[actionName];
  if (!handler) {
    throw new Error(`Unsupported group action: ${actionName}`);
  }

  const results = [];
  for (const processName of targetList) {
    if (!groupMembers.includes(processName)) {
      continue;
    }
    const result = await handler(processName);
    results.push({
      name: processName,
      success: result.success,
      error: result.error || null
    });
  }

  return {
    success: results.every((item) => item.success),
    data: {
      group: String(groupName || ""),
      action: actionName,
      order: targetList.filter((name) => groupMembers.includes(name)),
      results
    },
    error: null
  };
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
  updateGroupMembers,
  runBulkGroupAction,
  readProcessMetrics,
  readMonitoringSummary,
  exportProcessConfig,
  importProcessConfig,
  deployProcess,
  getDeploymentHistory
};

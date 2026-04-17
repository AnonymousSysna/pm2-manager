const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const pm2 = require("pm2");
const { withPM2 } = require("../utils/pm2Client");
const permissionHints = require("../utils/permissionHints.js");
const withPermissionHint =
  typeof permissionHints?.withPermissionHint === "function"
    ? permissionHints.withPermissionHint
    : (message) => String(message || "Operation failed");
const {
  ENV_KEY_PATTERN,
  sanitizeProcessName,
  sanitizeScriptPath,
  sanitizeEnvObject,
  resolveSafePath,
  sanitizeOptionalString,
  sanitizeNodeArgs,
  sanitizeMaxMemoryRestart,
  sanitizeInterpreter,
  sanitizeCronExpression,
  sanitizeGitCloneUrl
} = require("../utils/validation");
const { trackPm2Operation } = require("../middleware/metrics");
const { appendHistoryEntry } = require("../utils/restartHistory");
const {
  appendDeploymentHistory,
  listDeploymentHistory,
  listDeploymentHistoryPage
} = require("../utils/deploymentHistory");
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
  getHealthReport,
  getMonitoringSummary
} = require("../utils/metricsHistoryStore");
const { appendAuditEntry } = require("../utils/auditTrail");
const {
  getInterpreterInstallerStatus,
  installInterpreter
} = require("../utils/interpreterInstaller");
const {
  getNodeRuntimeCatalog,
  installNodeRuntimeVersion,
  resolveNodeRuntimeForVersion,
  detectNodeVersionFromProject,
  normalizeVersion
} = require("../utils/nodeRuntimeManager");
const { getUserSocketRoom } = require("../utils/socketSessions");

const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : DEFAULT_COMMAND_TIMEOUT_MS;
const LOG_TAIL_MAX_BYTES = Number.isFinite(Number(process.env.LOG_TAIL_MAX_BYTES))
  ? Math.max(64 * 1024, Math.floor(Number(process.env.LOG_TAIL_MAX_BYTES)))
  : 1024 * 1024;
const PROJECTS_ROOT = path.resolve(process.env.PROJECTS_ROOT || process.cwd());
const START_HEALTHCHECK_TIMEOUT_MS = Number.isFinite(Number(process.env.START_HEALTHCHECK_TIMEOUT_MS))
  ? Math.max(4000, Math.floor(Number(process.env.START_HEALTHCHECK_TIMEOUT_MS)))
  : 12 * 1000;
const START_HEALTHCHECK_STABILITY_MS = Number.isFinite(Number(process.env.START_HEALTHCHECK_STABILITY_MS))
  ? Math.max(1500, Math.floor(Number(process.env.START_HEALTHCHECK_STABILITY_MS)))
  : 3000;
const INTERPRETER_DETECT_TIMEOUT_MS = 4000;
const INTERPRETER_CATALOG = [
  {
    key: "node",
    displayName: "Node.js",
    clusterCapable: true,
    commands: [
      { command: "node", args: ["--version"] },
      { command: "nodejs", args: ["--version"] }
    ]
  },
  {
    key: "python",
    displayName: "Python",
    clusterCapable: false,
    commands: [
      { command: "python3", args: ["--version"] },
      { command: "python", args: ["--version"] }
    ]
  },
  {
    key: "php",
    displayName: "PHP",
    clusterCapable: false,
    commands: [{ command: "php", args: ["-v"] }]
  },
  {
    key: "ruby",
    displayName: "Ruby",
    clusterCapable: false,
    commands: [{ command: "ruby", args: ["-v"] }]
  },
  {
    key: "perl",
    displayName: "Perl",
    clusterCapable: false,
    commands: [{ command: "perl", args: ["-v"] }]
  },
  {
    key: "bash",
    displayName: "Bash",
    clusterCapable: false,
    commands: [{ command: "bash", args: ["--version"] }]
  },
  {
    key: "sh",
    displayName: "Shell (sh)",
    clusterCapable: false,
    commands: [{ command: "sh", args: ["--version"] }]
  },
  {
    key: "bun",
    displayName: "Bun",
    clusterCapable: false,
    commands: [{ command: "bun", args: ["--version"] }]
  },
  {
    key: "deno",
    displayName: "Deno",
    clusterCapable: false,
    commands: [{ command: "deno", args: ["--version"] }]
  },
  {
    key: "powershell",
    displayName: "PowerShell",
    clusterCapable: false,
    commands: [
      { command: "pwsh", args: ["-Version"] },
      { command: "powershell", args: ["-Version"] }
    ]
  }
];
const STATIC_SITE_DEFAULT_PORT = 3000;
const STATIC_SITE_CANDIDATES = [
  { relativeEntry: "index.html", relativeServeDir: "." },
  { relativeEntry: path.join("public", "index.html"), relativeServeDir: "public" },
  { relativeEntry: path.join("dist", "index.html"), relativeServeDir: "dist" }
];

/**
 * @typedef {Object} CreateProcessConfig
 * @property {string} name
 * @property {string} [script]
 * @property {number|string} [port]
 * @property {number} [instances]
 * @property {string} [exec_mode]
 * @property {Record<string, string>} [env]
 * @property {string} [cwd]
 * @property {boolean} [watch]
 * @property {string} [args]
 * @property {string} [max_memory_restart]
 * @property {string} [node_args]
 * @property {string} [interpreter]
 * @property {string} [log_date_format]
 * @property {string} [cron_restart]
 * @property {string} [project_path]
 * @property {string} [git_clone_url]
 * @property {string} [git_branch]
 * @property {string} [env_file_content]
 * @property {boolean} [install_dependencies]
 * @property {boolean} [run_build]
 * @property {string} [start_script]
 * @property {string} [node_version]
 * @property {boolean} [auto_install_node]
 */

/**
 * @typedef {Object} CommandStep
 * @property {string} label
 * @property {boolean} success
 * @property {number} durationMs
 * @property {string} [output]
 * @property {string} [error]
 */

function normalizeActorContext(actorOrContext = "unknown") {
  if (actorOrContext && typeof actorOrContext === "object") {
    return {
      actor: String(actorOrContext.actor || "unknown").trim() || "unknown",
      ip: String(actorOrContext.ip || "unknown").trim() || "unknown"
    };
  }

  return {
    actor: String(actorOrContext || "unknown").trim() || "unknown",
    ip: "unknown"
  };
}

function sanitizeGitRemoteName(value) {
  const normalized = String(value || "").trim() || "origin";
  if (normalized.startsWith("-")) {
    throw new Error("gitRemote cannot start with '-'");
  }
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(normalized)) {
    throw new Error("gitRemote contains invalid characters");
  }
  return normalized;
}

function sanitizeGitRef(value, fieldName, { allowEmpty = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    if (allowEmpty) {
      return "";
    }
    throw new Error(`${fieldName} is required`);
  }
  if (normalized.startsWith("-")) {
    throw new Error(`${fieldName} cannot start with '-'`);
  }
  if (/\s/.test(normalized)) {
    throw new Error(`${fieldName} cannot contain whitespace`);
  }
  if (normalized.length > 200) {
    throw new Error(`${fieldName} exceeds max length 200`);
  }
  return normalized;
}

async function pathIsReadableFile(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch (_error) {
    return false;
  }
}

async function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await runCommand(probe, [command], process.cwd());
    return true;
  } catch (_error) {
    return false;
  }
}

async function detectStaticSiteProject(projectDir) {
  for (const candidate of STATIC_SITE_CANDIDATES) {
    const entryPath = path.join(projectDir, candidate.relativeEntry);
    if (await pathIsReadableFile(entryPath)) {
      const serveDir = path.resolve(projectDir, candidate.relativeServeDir);
      return {
        isStaticSite: true,
        entryPath,
        serveDir
      };
    }
  }

  return {
    isStaticSite: false,
    entryPath: "",
    serveDir: ""
  };
}

async function resolveStaticSiteServer() {
  const candidates = process.platform === "win32"
    ? ["py", "python", "python3"]
    : ["python3", "python"];

  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }

  return "";
}

async function writeAudit(action, actorOrContext, payload = {}) {
  const { actor, ip } = normalizeActorContext(actorOrContext);
  try {
    await appendAuditEntry({
      action: String(action || "unknown").trim() || "unknown",
      actor,
      ip,
      ...payload
    });
  } catch (_error) {
    // Best-effort audit append.
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRestartCount(proc) {
  return Number(proc?.pm2_env?.restart_time || 0);
}

async function waitForHealthyStart(processName, baselineRestarts = 0) {
  const timeoutMs = START_HEALTHCHECK_TIMEOUT_MS;
  const stableForMs = START_HEALTHCHECK_STABILITY_MS;
  const startedAt = Date.now();
  let onlineSince = 0;
  let lastStatus = "unknown";
  let lastRestarts = Number(baselineRestarts || 0);

  while (Date.now() - startedAt < timeoutMs) {
    const proc = await describeProcess(processName);
    if (!proc) {
      lastStatus = "missing";
      onlineSince = 0;
      await sleep(500);
      continue;
    }

    const status = String(proc?.pm2_env?.status || "unknown");
    const pid = Number(proc?.pid || 0);
    const restarts = readRestartCount(proc);
    lastStatus = status;
    lastRestarts = restarts;

    if (restarts > baselineRestarts) {
      return {
        ok: false,
        reason: `${processName} restarted during startup (restart count increased from ${baselineRestarts} to ${restarts})`,
        status,
        restarts
      };
    }

    if (status === "online" && pid > 0) {
      if (!onlineSince) {
        onlineSince = Date.now();
      }
      if (Date.now() - onlineSince >= stableForMs) {
        return { ok: true, status, pid, restarts };
      }
    } else {
      onlineSince = 0;
    }

    await sleep(500);
  }

  return {
    ok: false,
    reason: `${processName} did not become healthy within ${timeoutMs}ms (last status: ${lastStatus})`,
    status: lastStatus,
    restarts: lastRestarts
  };
}

function checkPortBinding(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    const finalize = (payload) => {
      try {
        server.close(() => resolve(payload));
      } catch (_error) {
        resolve(payload);
      }
    };

    server.once("error", (error) => {
      resolve({
        available: false,
        code: error?.code || "UNKNOWN"
      });
    });

    server.once("listening", () => {
      finalize({ available: true, code: null });
    });

    server.listen({
      port,
      host: "0.0.0.0",
      exclusive: true
    });
  });
}

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

async function readNpmCapabilities(cwd) {
  const base = String(cwd || "").trim();
  if (!base) {
    return {
      hasPackageJson: false,
      hasBuildScript: false,
      hasStartScript: false
    };
  }

  const packageJsonPath = path.join(base, "package.json");
  if (!(await pathIsReadableFile(packageJsonPath))) {
    return {
      hasPackageJson: false,
      hasBuildScript: false,
      hasStartScript: false
    };
  }

  try {
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf8"));
    const scripts = packageJson && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
    return {
      hasPackageJson: true,
      hasBuildScript: Boolean(scripts.build),
      hasStartScript: Boolean(scripts.start)
    };
  } catch (_error) {
    return {
      hasPackageJson: true,
      hasBuildScript: false,
      hasStartScript: false
    };
  }
}

function isNodeInterpreterValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return ["node", "nodejs", "node.exe"].includes(normalized)
    || normalized.endsWith("/node")
    || normalized.endsWith("\\node.exe");
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

function runCommand(command, args, cwd, options = {}) {
  const childEnv = options && typeof options === "object" && options.env
    ? { ...process.env, ...options.env }
    : process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv,
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
      const baseMessage = `Command failed (${command} ${args.join(" ")}), exit code ${code}${
        stderr ? `: ${stderr.trim()}` : ""
      }`;
      reject(new Error(withPermissionHint(baseMessage, { command, args })));
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

function normalizeDiskEntries(entries = []) {
  return entries
    .map((item) => {
      const totalBytes = Number(item.totalBytes || 0);
      const freeBytes = Number(item.freeBytes || 0);
      const usedBytes = Math.max(0, totalBytes - freeBytes);
      return {
        mount: String(item.mount || "").trim(),
        filesystem: String(item.filesystem || "").trim() || null,
        totalBytes,
        usedBytes,
        freeBytes,
        usedPercent: totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0
      };
    })
    .filter((item) => item.mount && item.totalBytes > 0);
}

async function readDiskUsage() {
  if (process.platform === "win32") {
    const psScript = "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress";
    const psResult = await runCommand("powershell", ["-NoProfile", "-Command", psScript], process.cwd());
    const raw = String(psResult.stdout || "").trim();
    let parsed = [];
    try {
      const value = JSON.parse(raw || "[]");
      parsed = Array.isArray(value) ? value : [value];
    } catch (_error) {
      parsed = [];
    }
    return normalizeDiskEntries(
      parsed.map((item) => ({
        mount: String(item.DeviceID || "").trim(),
        totalBytes: Number(item.Size || 0),
        freeBytes: Number(item.FreeSpace || 0),
        filesystem: "ntfs"
      }))
    );
  }

  const dfResult = await runCommand("df", ["-kP"], process.cwd());
  const lines = String(dfResult.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  const entries = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) {
      continue;
    }
    const [filesystem, totalKb, usedKb, availableKb] = parts;
    const mount = parts[parts.length - 1];
    entries.push({
      mount,
      filesystem,
      totalBytes: Number(totalKb || 0) * 1024,
      freeBytes: Number(availableKb || 0) * 1024,
      usedBytes: Number(usedKb || 0) * 1024
    });
  }

  return normalizeDiskEntries(entries);
}

function runDetectCommand(command, args) {
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
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, INTERPRETER_DETECT_TIMEOUT_MS);

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
        reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
        return;
      }
      if (code === 0) {
        resolve({ command, args, stdout, stderr, code });
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(" ")} (exit ${code})`));
    });
  });
}

function pickVersionText(stdout = "", stderr = "") {
  const merged = `${stdout || ""}\n${stderr || ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return merged[0] || null;
}

async function detectInterpreter(entry) {
  const supportedCommands = entry.commands.map((item) => item.command);
  for (const candidate of entry.commands) {
    try {
      const result = await runDetectCommand(candidate.command, candidate.args || []);
      return {
        key: entry.key,
        displayName: entry.displayName,
        installed: true,
        interpreter: candidate.command,
        version: pickVersionText(result.stdout, result.stderr),
        supportedCommands,
        clusterCapable: Boolean(entry.clusterCapable)
      };
    } catch (_error) {
      // Try next command alias.
    }
  }

  return {
    key: entry.key,
    displayName: entry.displayName,
    installed: false,
    interpreter: null,
    version: null,
    supportedCommands,
    clusterCapable: Boolean(entry.clusterCapable)
  };
}

function buildStepFailureMessage(prefix, steps = [], fallbackError = "") {
  const failed = [...steps].reverse().find((step) => step && step.success === false);
  if (!failed) {
    return `${prefix}: ${fallbackError || "unknown error"}`;
  }
  const base = `${prefix} at ${failed.label}: ${failed.error || fallbackError || "unknown error"}`;
  return compactOutput(base);
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

function parsePortValue(portValue) {
  if (portValue === undefined || portValue === null || portValue === "") {
    return null;
  }
  const parsed = Number(portValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error("port must be an integer");
  }
  if (parsed < 1 || parsed > 65535) {
    throw new Error("port must be between 1 and 65535");
  }
  return parsed;
}

async function findProcessByPort(port) {
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  const processes = await new Promise((resolve, reject) => {
    pm2.list((error, list) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Array.isArray(list) ? list : []);
    });
  });

  for (const proc of processes) {
    const env = proc?.pm2_env?.env || {};
    let processPort = null;
    try {
      processPort = parsePortValue(findPort(env));
    } catch (_error) {
      processPort = null;
    }
    if (processPort === port) {
      return proc;
    }
  }

  return null;
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
    cronRestart: String(pm2Env.cron_restart || "").trim() || null,
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

async function startProcess(name, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
  const result = await withPM2(async () => {
    const before = await describeProcess(processName).catch(() => null);
    const baselineRestarts = before ? readRestartCount(before) : 0;

    await new Promise((resolve, reject) => {
      pm2.start(processName, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const health = await waitForHealthyStart(processName, baselineRestarts);
    if (!health.ok) {
      throw new Error(health.reason || `${processName} failed startup validation`);
    }

    return {
      processName,
      health
    };
  });
  trackPm2Operation("processes.start", result.success);
  if (result.success) {
    try {
      await appendHistoryEntry({
        processName,
        event: "start",
        source: "api",
        actor
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
  await writeAudit("process.start", { actor, ip }, {
    processName,
    success: result.success,
    details: result.success ? result.data?.health || null : null,
    error: result.success ? null : result.error || "start failed"
  });
  return result;
}

async function stopProcess(name, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
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
    try {
      await appendHistoryEntry({
        processName,
        event: "stop",
        source: "api",
        actor
      });
    } catch (_error) {
      // Best-effort audit append: do not fail stop operation.
    }
    await recordOperationNotification({
      category: "operation",
      title: `${processName} stopped`,
      message: `Stop operation completed for ${processName}`,
      processName
    });
  }
  await writeAudit("process.stop", { actor, ip }, {
    processName,
    success: result.success,
    error: result.success ? null : result.error || "stop failed"
  });
  return result;
}

async function restartProcess(name, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
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
        source: "api",
        actor
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
  await writeAudit("process.restart", { actor, ip }, {
    processName,
    success: result.success,
    error: result.success ? null : result.error || "restart failed"
  });
  return result;
}

async function runBulkAction(action, names = [], actorContext = "unknown") {
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

  const sanitizedNames = [];
  for (let index = 0; index < names.length; index += 1) {
    try {
      sanitizedNames.push(sanitizeProcessName(names[index], "process name"));
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error?.message || `Invalid process name at index ${index}`
      };
    }
  }

  const uniqueNames = [...new Set(sanitizedNames)];
  const handler = {
    start: startProcess,
    stop: stopProcess,
    restart: restartProcess
  }[safeAction];

  const results = [];
  for (const processName of uniqueNames) {
    const result = await handler(processName, actorContext);
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

function collectInvalidDotEnvLines(content = "") {
  const lines = String(content ?? "").split(/\r?\n/);
  const invalid = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    if (/^(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(trimmed)) {
      return;
    }
    invalid.push({
      line: index + 1,
      content: line
    });
  });
  return invalid;
}

async function updateProcessEnv(name, envPatch = {}, options = {}, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
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
  await writeAudit("process.env.update", { actor, ip }, {
    processName,
    success: result.success,
    details: result.success
      ? {
          replace,
          keys: result.data?.keys || []
        }
      : null,
    error: result.success ? null : result.error || "env update failed"
  });
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
        entries: [],
        invalidLines: []
      };
    }

    const content = await fs.promises.readFile(envPath, "utf8");
    const parsed = parseDotEnvContent(content);
    const invalidLines = collectInvalidDotEnvLines(content);
    return {
      processName,
      cwd,
      allowedRoot,
      envPath,
      hasEnvFile: true,
      entries: parsed.entries,
      invalidLines
    };
  });
  trackPm2Operation("processes.dotenv.read", result.success);
  return result;
}

async function updateProcessDotEnv(name, payload = {}, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
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
    const value = String(rawValue ?? "");
    if (/\r|\n/.test(value)) {
      return { success: false, data: null, error: `Invalid newline in value for ${key}` };
    }
    values[key] = value;
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
    const invalidLines = collectInvalidDotEnvLines(content);
    if (invalidLines.length > 0) {
      throw new Error(
        `.env has invalid syntax on line(s): ${invalidLines
          .slice(0, 5)
          .map((item) => item.line)
          .join(", ")}`
      );
    }
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
    const nextInvalidLines = collectInvalidDotEnvLines(nextLines.join(eol));
    if (nextInvalidLines.length > 0) {
      throw new Error(
        `.env validation failed after update on line(s): ${nextInvalidLines
          .slice(0, 5)
          .map((item) => item.line)
          .join(", ")}`
      );
    }
    return {
      processName,
      cwd,
      allowedRoot,
      envPath,
      hasEnvFile: true,
      updatedCount,
      entries: nextParsed.entries,
      invalidLines: []
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
  await writeAudit("process.dotenv.update", { actor, ip }, {
    processName,
    success: result.success,
    details: result.success
      ? {
          updatedKeys: Object.keys(values),
          updatedCount: result.data?.updatedCount || 0
        }
      : null,
    error: result.success ? null : result.error || "dotenv update failed"
  });
  return result;
}

async function deleteProcess(name, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
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
  await writeAudit("process.delete", { actor, ip }, {
    processName,
    success: result.success,
    error: result.success ? null : result.error || "delete failed"
  });
  return result;
}

/**
 * @param {CreateProcessConfig} config
 */
async function createProcess(config, actorContext = "unknown") {
  const { actor, ip } = normalizeActorContext(actorContext);
  const io = actorContext && typeof actorContext === "object" ? actorContext.io : null;
  const createOperationId = actorContext && typeof actorContext === "object"
    ? String(actorContext.createOperationId || config?.create_operation_id || "").trim()
    : String(config?.create_operation_id || "").trim();
  let processNameForAudit = String(config?.name || "").trim();
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
      cron_restart,
      project_path,
      git_clone_url,
      git_branch,
      env_file_content,
      install_dependencies,
      run_build,
      start_script,
      node_version,
      auto_install_node
    } = config;

    const safeName = sanitizeProcessName(name, "process name");
    processNameForAudit = safeName;
    let normalizedPort = parsePortValue(port);
    let createStepCounter = 0;
    const createStepTarget = actor && actor !== "unknown" && io && typeof io.to === "function"
      ? io.to(getUserSocketRoom(actor))
      : io;
    const emitCreateStep = (payload = {}) => {
      if (!createStepTarget || typeof createStepTarget.emit !== "function" || !createOperationId) {
        return;
      }
      createStepTarget.emit("process:create:step", {
        operationId: createOperationId,
        processName: safeName,
        timestamp: Date.now(),
        ...payload
      });
    };
    /** @type {CommandStep[]} */
    const createSteps = [];
    const runCreateStep = async (label, command, commandArgs, commandCwd, commandOptions = {}) => {
      const stepId = `${label}#${++createStepCounter}`;
      const startedAt = Date.now();
      emitCreateStep({ stepId, label, status: "started" });
      try {
        const output = await runCommand(command, commandArgs, commandCwd, commandOptions);
        const durationMs = Date.now() - startedAt;
        createSteps.push({
          label,
          success: true,
          durationMs,
          output: compactOutput(`${output.stdout || ""}\n${output.stderr || ""}`)
        });
        emitCreateStep({ stepId, label, status: "success", durationMs });
        return output;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        createSteps.push({
          label,
          success: false,
          durationMs,
          error: error.message
        });
        emitCreateStep({
          stepId,
          label,
          status: "error",
          durationMs,
          error: error?.message || "Step failed"
        });
        throw error;
      }
    };
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
    let resolvedInterpreterOverride = "";
    let resolvedNodeVersion = normalizeVersion(node_version);
    let forceForkMode = false;

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
        const gitUrl = sanitizeGitCloneUrl(cloneUrl, "git_clone_url");

        if (!projectStat) {
          await fs.promises.mkdir(projectDir, { recursive: true });
          projectStat = await fs.promises.stat(projectDir);
        }

        if (!projectStat.isDirectory()) {
          throw new Error(`Project path is not a directory: ${projectDir}`);
        }

        if (await directoryIsEmpty(projectDir)) {
          const cloneArgs = ["clone"];
          if (cloneBranch) {
            cloneArgs.push("--branch", cloneBranch, "--single-branch");
          }
          cloneArgs.push(gitUrl, projectDir);
          await runCreateStep("git:clone", "git", cloneArgs, PROJECTS_ROOT);
        } else {
          try {
            await runCommand("git", ["rev-parse", "--is-inside-work-tree"], projectDir);
          } catch (_error) {
            throw new Error(`Project path is not empty and not a git repository: ${projectDir}`);
          }

          const existingOrigin = (await runCommand("git", ["remote", "get-url", "origin"], projectDir))
            .stdout
            .trim();
          if (existingOrigin && existingOrigin !== gitUrl) {
            throw new Error(
              `Project path already uses a different origin remote. expected=${gitUrl} actual=${existingOrigin}`
            );
          }

          await runCreateStep("git:fetch", "git", ["fetch", "origin", "--prune"], projectDir);
          if (cloneBranch) {
            await runCreateStep("git:checkout", "git", ["checkout", cloneBranch], projectDir);
            await runCreateStep("git:pull", "git", ["pull", "--ff-only", "origin", cloneBranch], projectDir);
          } else {
            await runCreateStep("git:pull", "git", ["pull", "--ff-only"], projectDir);
          }
        }

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
        const staticSite = await detectStaticSiteProject(projectDir);
        if (!staticSite.isStaticSite) {
          throw new Error(`package.json not found at: ${packageJsonPath}`);
        }

        const staticServerCommand = await resolveStaticSiteServer();
        if (!staticServerCommand) {
          throw new Error(
            `Static site detected at ${staticSite.entryPath}, but no supported static file server was found. Install python3/python or use Script Path mode.`
          );
        }

        normalizedPort = normalizedPort || STATIC_SITE_DEFAULT_PORT;
        finalScript = staticServerCommand;
        finalArgs = `-m http.server ${normalizedPort}`;
        finalCwd = staticSite.serveDir;
        resolvedInterpreterOverride = "none";
        forceForkMode = true;
        createSteps.push({
          label: "static:detect",
          success: true,
          durationMs: 0,
          output: `Static site detected (${path.relative(projectDir, staticSite.entryPath) || "index.html"}) -> ${staticServerCommand} -m http.server ${normalizedPort}`
        });
        emitCreateStep({
          stepId: `static:detect#${++createStepCounter}`,
          label: "static:detect",
          status: "success",
          durationMs: 0
        });
      }

      if (!finalScript || !String(finalScript).trim()) {
        throw new Error(`Unable to determine runtime for project: ${projectDir}`);
      }

      if (resolvedInterpreterOverride === "none") {
        finalCwd = resolveSafePath(String(finalCwd || projectDir), PROJECTS_ROOT, "cwd");
      } else {
        const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf8"));
        const scripts = packageJson.scripts || {};
        let npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
        const startScriptName = String(start_script || "start").trim() || "start";
        const shouldUseNodeRuntime = isNodeInterpreterValue(interpreter);
        let npmCommandArgsBuilder = (nextArgs = []) => nextArgs;
        let stepCommandOptions = {};

        if (!resolvedNodeVersion && shouldUseNodeRuntime) {
          resolvedNodeVersion = await detectNodeVersionFromProject(projectDir);
        }

        if (resolvedNodeVersion && shouldUseNodeRuntime) {
          const runtime = await resolveNodeRuntimeForVersion(resolvedNodeVersion, {
            autoInstall: Boolean(auto_install_node)
          });
          if (runtime) {
            resolvedNodeVersion = normalizeVersion(runtime.version);
            resolvedInterpreterOverride = String(runtime.nodePath || "").trim();
            npmCmd = runtime.npmCommand || npmCmd;
            npmCommandArgsBuilder = runtime.wrapNpmArgs || ((nextArgs = []) => nextArgs);
          }
        }

        if (install_dependencies) {
          const installArgs = getNpmInstallArgs({ includeDev: Boolean(run_build) });
          await runCreateStep(
            "npm:install",
            npmCmd,
            npmCommandArgsBuilder(installArgs),
            projectDir,
            stepCommandOptions
          );
          const nestedInstallDirs = await resolveNestedInstallDirs(projectDir, safeName);
          for (const installDir of nestedInstallDirs) {
            await runCreateStep(
              "npm:install:nested",
              npmCmd,
              npmCommandArgsBuilder(installArgs),
              installDir,
              stepCommandOptions
            );
          }
        }

        if (run_build) {
          if (!scripts.build) {
            throw new Error(`Missing "build" script in ${packageJsonPath}`);
          }
          try {
            await runCreateStep(
              "npm:build",
              npmCmd,
              npmCommandArgsBuilder(["run", "build"]),
              projectDir,
              stepCommandOptions
            );
          } catch (error) {
            const missingModule = extractMissingModule(error?.message || "");
            if (missingModule) {
              if (install_dependencies) {
                const preferredNestedDir = await resolvePreferredNestedAppDir(projectDir, safeName);
                const installTargetDir = preferredNestedDir || projectDir;
                try {
                  await runCreateStep(
                    "npm:install-missing-module",
                    npmCmd,
                    npmCommandArgsBuilder(["install", "--include=dev", "--save-dev", missingModule]),
                    installTargetDir,
                    stepCommandOptions
                  );
                  await runCreateStep(
                    "npm:build:retry",
                    npmCmd,
                    npmCommandArgsBuilder(["run", "build"]),
                    projectDir,
                    stepCommandOptions
                  );
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
            }
            throw error;
          }
        }

        if (!scripts[startScriptName]) {
          throw new Error(`Missing "${startScriptName}" script in ${packageJsonPath}`);
        }

        finalScript = npmCmd;
        finalArgs = npmCommandArgsBuilder(["run", startScriptName]).join(" ");
        finalCwd = projectDir;
      }
    }

    if (resolvedNodeVersion && isNodeInterpreterValue(interpreter) && !resolvedInterpreterOverride) {
      const runtime = await resolveNodeRuntimeForVersion(resolvedNodeVersion, {
        autoInstall: Boolean(auto_install_node)
      });
      if (runtime) {
        resolvedNodeVersion = normalizeVersion(runtime.version);
        resolvedInterpreterOverride = String(runtime.nodePath || "").trim();
        const normalizedFinalScript = String(finalScript || "").trim().toLowerCase();
        const isNpmEntry = ["npm", "npm.cmd"].includes(normalizedFinalScript);
        if (isNpmEntry) {
          if (runtime.manager === "fnm") {
            finalScript = "fnm";
            finalArgs = `exec --using ${resolvedNodeVersion} -- npm${finalArgs ? ` ${String(finalArgs).trim()}` : ""}`;
          } else if (runtime.npmCommand) {
            finalScript = runtime.npmCommand;
          }
        }
      }
    }

    if (!finalScript || !String(finalScript).trim()) {
      throw new Error("Script path is required");
    }
    const safeScript = sanitizeScriptPath(finalScript);
    const safeEnv = sanitizeEnvObject(env);
    const safeCwd = resolveSafePath(String(finalCwd || process.cwd()), PROJECTS_ROOT, "cwd");

    const parsedInstances = Number(instances || 1);
    const safeInstances = forceForkMode
      ? 1
      : Number.isFinite(parsedInstances)
      ? Math.min(64, Math.max(1, Math.floor(parsedInstances)))
      : 1;

    const incomingMode = String(exec_mode || "fork").trim();
    const safeExecMode = forceForkMode
      ? "fork"
      :
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
        ...(normalizedPort ? { PORT: String(normalizedPort) } : {}),
        ...(resolvedNodeVersion ? { NODE_VERSION: resolvedNodeVersion } : {})
      },
      max_memory_restart: sanitizeMaxMemoryRestart(max_memory_restart),
      node_args: sanitizeNodeArgs(node_args),
      interpreter: sanitizeInterpreter(resolvedInterpreterOverride || interpreter),
      log_date_format: sanitizeOptionalString(log_date_format, "log_date_format", 128),
      cron_restart: sanitizeCronExpression(cron_restart)
    };

    if (normalizedPort) {
      const existingProcess = await findProcessByPort(normalizedPort);
      if (existingProcess) {
        const existingName = String(existingProcess.name || existingProcess.pm2_env?.name || "").trim() || "unknown process";
        if (existingName === safeName) {
          throw new Error(`Port ${normalizedPort} is already in use: ${safeName} was already using that port`);
        }
        throw new Error(`Port ${normalizedPort} is already in use by ${existingName}`);
      }

      const portBinding = await checkPortBinding(normalizedPort);
      if (!portBinding.available) {
        const suffix = portBinding.code ? ` (${portBinding.code})` : "";
        throw new Error(`Port ${normalizedPort} is already in use by another service${suffix}`);
      }
    }

    return new Promise((resolve, reject) => {
      const stepId = `pm2:start#${++createStepCounter}`;
      const startedAt = Date.now();
      emitCreateStep({ stepId, label: "pm2:start", status: "started" });
      pm2.start(processConfig, (error, proc) => {
        if (error) {
          const durationMs = Date.now() - startedAt;
          createSteps.push({
            label: "pm2:start",
            success: false,
            durationMs,
            error: error.message
          });
          emitCreateStep({
            stepId,
            label: "pm2:start",
            status: "error",
            durationMs,
            error: error?.message || "Failed to start process"
          });
          reject(error);
          return;
        }
        const durationMs = Date.now() - startedAt;
        createSteps.push({
          label: "pm2:start",
          success: true,
          durationMs,
          output: "Process started"
        });
        emitCreateStep({ stepId, label: "pm2:start", status: "success", durationMs });
        resolve({
          processName: safeName,
          cwd: safeCwd,
          steps: createSteps,
          baselineRestarts: readRestartCount(Array.isArray(proc) ? proc[0] : proc),
          pm2: proc
        });
      });
    }).then(async (started) => {
      const stepId = `pm2:healthcheck#${++createStepCounter}`;
      const baselineRestarts = Number(started?.baselineRestarts || 0);
      const healthStartedAt = Date.now();
      emitCreateStep({ stepId, label: "pm2:healthcheck", status: "started" });
      const health = await waitForHealthyStart(safeName, baselineRestarts);
      if (!health.ok) {
        const durationMs = Date.now() - healthStartedAt;
        createSteps.push({
          label: "pm2:healthcheck",
          success: false,
          durationMs,
          error: health.reason
        });
        emitCreateStep({
          stepId,
          label: "pm2:healthcheck",
          status: "error",
          durationMs,
          error: health?.reason || "Healthcheck failed"
        });
        throw new Error(health.reason || `Startup validation failed for ${safeName}`);
      }
      const durationMs = Date.now() - healthStartedAt;
      createSteps.push({
        label: "pm2:healthcheck",
        success: true,
        durationMs,
        output: `Stable online status for ${safeName}`
      });
      emitCreateStep({ stepId, label: "pm2:healthcheck", status: "success", durationMs });
      return {
        ...started,
        health
      };
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
  await writeAudit("process.create", { actor, ip }, {
    processName: processNameForAudit || null,
    success: result.success,
    details: result.success
      ? {
          steps: result.data?.steps || [],
          health: result.data?.health || null
        }
      : null,
    error: result.success ? null : result.error || "create failed"
  });
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

async function reloadProcess(name, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
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
        source: "api",
        actor
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
  await writeAudit("process.reload", { actor, ip }, {
    processName,
    success: result.success,
    error: result.success ? null : result.error || "reload failed"
  });
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

async function readSystemResources() {
  try {
    const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 0;
    const totalMemoryBytes = Number(os.totalmem() || 0);
    const freeMemoryBytes = Number(os.freemem() || 0);
    const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
    const disks = await readDiskUsage().catch(() => []);

    const diskTotalBytes = disks.reduce((sum, item) => sum + Number(item.totalBytes || 0), 0);
    const diskFreeBytes = disks.reduce((sum, item) => sum + Number(item.freeBytes || 0), 0);
    const diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);

    return {
      success: true,
      data: {
        hostname: os.hostname(),
        platform: process.platform,
        uptimeSec: Math.floor(Number(os.uptime() || 0)),
        loadAverage: os.loadavg(),
        cpu: {
          cores: cpuCount
        },
        memory: {
          totalBytes: totalMemoryBytes,
          usedBytes: usedMemoryBytes,
          freeBytes: freeMemoryBytes,
          usedPercent: totalMemoryBytes > 0 ? Number(((usedMemoryBytes / totalMemoryBytes) * 100).toFixed(1)) : 0
        },
        disk: {
          totalBytes: diskTotalBytes,
          usedBytes: diskUsedBytes,
          freeBytes: diskFreeBytes,
          usedPercent: diskTotalBytes > 0 ? Number(((diskUsedBytes / diskTotalBytes) * 100).toFixed(1)) : 0,
          mounts: disks
        }
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error?.message || "Failed to read system resources"
    };
  }
}

async function updateProcessSchedule(name, payload = {}, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);

  let cronRestart;
  try {
    cronRestart = sanitizeCronExpression(payload.cron_restart);
  } catch (error) {
    return { success: false, data: null, error: error?.message || "Invalid cron_restart" };
  }

  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.restart(
          {
            name: processName,
            cron_restart: cronRestart || 0,
            updateEnv: true
          },
          (error, proc) => {
            if (error) {
              reject(error);
              return;
            }
            const first = Array.isArray(proc) ? proc[0] : proc;
            const appliedCron = String(first?.pm2_env?.cron_restart || "").trim() || null;
            resolve({
              processName,
              cronRestart: appliedCron
            });
          }
        );
      })
  );

  trackPm2Operation("processes.schedule.update", result.success);
  if (result.success) {
    await recordOperationNotification({
      category: "operation",
      title: `${processName} schedule updated`,
      message: result.data?.cronRestart
        ? `cron_restart set to ${result.data.cronRestart}`
        : "cron_restart disabled",
      processName,
      details: result.data
    });
  }
  await writeAudit("process.schedule.update", { actor, ip }, {
    processName,
    success: result.success,
    details: result.success ? result.data : { requested: cronRestart || null },
    error: result.success ? null : result.error || "schedule update failed"
  });
  return result;
}

async function duplicateProcess(name, payload = {}, actorContext = "unknown") {
  const sourceName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
  const targetName = sanitizeProcessName(payload?.name, "duplicate process name");

  if (sourceName === targetName) {
    return { success: false, data: null, error: "duplicate process name must differ from source process name" };
  }

  const result = await withPM2(async () => {
    const source = await describeProcess(sourceName);
    if (!source) {
      throw new Error(`Process not found: ${sourceName}`);
    }

    const existingTarget = await describeProcess(targetName);
    if (existingTarget) {
      throw new Error(`Process already exists: ${targetName}`);
    }

    const pm2Env = source.pm2_env || {};
    const sourceEnv = pm2Env.env && typeof pm2Env.env === "object" ? pm2Env.env : {};
    const envWithoutName = { ...sourceEnv };
    delete envWithoutName.name;
    delete envWithoutName.pm_id;

    const nextConfig = {
      name: targetName,
      script: sanitizeScriptPath(pm2Env.pm_exec_path || source.pm_exec_path || ""),
      cwd: path.resolve(pm2Env.pm_cwd || process.cwd()),
      args: sanitizeOptionalString(pm2Env.args && Array.isArray(pm2Env.args) ? pm2Env.args.join(" ") : pm2Env.args, "args", 1024),
      node_args: sanitizeNodeArgs(pm2Env.node_args),
      interpreter: sanitizeInterpreter(pm2Env.exec_interpreter),
      exec_mode: String(pm2Env.exec_mode || "").includes("cluster") ? "cluster" : "fork",
      instances: Number.isFinite(Number(pm2Env.instances)) ? Math.max(1, Number(pm2Env.instances)) : 1,
      watch: Boolean(pm2Env.watch),
      max_memory_restart: sanitizeMaxMemoryRestart(pm2Env.max_memory_restart),
      log_date_format: sanitizeOptionalString(pm2Env.log_date_format, "log_date_format", 128),
      cron_restart: sanitizeCronExpression(pm2Env.cron_restart),
      env: sanitizeEnvObject(envWithoutName)
    };

    await new Promise((resolve, reject) => {
      pm2.start(nextConfig, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const created = await describeProcess(targetName);
    if (!created) {
      throw new Error(`Failed to verify duplicated process: ${targetName}`);
    }

    return {
      sourceName,
      targetName,
      cronRestart: String(created?.pm2_env?.cron_restart || "").trim() || null
    };
  });

  trackPm2Operation("processes.duplicate", result.success);
  if (result.success) {
    await recordOperationNotification({
      category: "operation",
      title: `${sourceName} duplicated`,
      message: `Created ${targetName} from ${sourceName}`,
      processName: targetName,
      details: result.data
    });
  }
  await writeAudit("process.duplicate", { actor, ip }, {
    processName: targetName,
    success: result.success,
    details: result.success ? result.data : { sourceName },
    error: result.success ? null : result.error || "duplicate failed"
  });

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

/**
 * @param {string} name
 * @param {{
 *   branch?: string,
 *   installDependencies?: boolean,
 *   runBuild?: boolean,
 *   restartMode?: "restart"|"reload",
 *   gitRemote?: string
 * }} [options]
 * @param {string} [actor]
 */
async function deployProcess(name, options = {}, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
  let branch = "";
  let gitRemote = "origin";
  try {
    branch = sanitizeGitRef(options.branch, "branch", { allowEmpty: true });
    gitRemote = sanitizeGitRemoteName(options.gitRemote);
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error.message || "Invalid deploy options"
    };
  }
  const installDependencies = options.installDependencies !== false;
  const runBuild = options.runBuild !== false;
  const restartMode = String(options.restartMode || "restart").trim() === "reload" ? "reload" : "restart";
  /** @type {CommandStep[]} */
  const deploymentSteps = [];

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

    const steps = deploymentSteps;
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const npmCapabilities = await readNpmCapabilities(cwd);
    const canInstallDependencies = npmCapabilities.hasPackageJson;
    const canRunBuild = npmCapabilities.hasBuildScript;

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

    try {
      await runStep("git:check", "git", ["rev-parse", "--is-inside-work-tree"]);
      await runStep("git:fetch", "git", ["fetch", gitRemote, "--prune"]);

      if (branch) {
        await runStep("git:checkout", "git", ["checkout", branch]);
        await runStep("git:pull", "git", ["pull", "--ff-only", gitRemote, branch]);
      } else {
        await runStep("git:pull", "git", ["pull", "--ff-only"]);
      }

      if (installDependencies && canInstallDependencies) {
        await runStep("npm:install", npmCmd, getNpmInstallArgs({ includeDev: runBuild }));
      }

      if (runBuild && canRunBuild) {
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
    } catch (error) {
      throw new Error(buildStepFailureMessage("Deployment failed", steps, error?.message || ""));
    }

    return {
      processName,
      cwd,
      branch: branch || null,
      installDependencies: installDependencies && canInstallDependencies,
      runBuild: runBuild && canRunBuild,
      restartMode,
      npmCapabilities,
      steps
    };
  });

  trackPm2Operation("processes.deploy", result.success);
  await appendDeploymentHistory({
    processName,
    actor,
    success: result.success,
    branch: branch || null,
    installDependencies: result.success
      ? Boolean(result.data.installDependencies)
      : Boolean(installDependencies),
    runBuild: result.success ? Boolean(result.data.runBuild) : Boolean(runBuild),
    restartMode,
    steps: result.success ? result.data.steps : deploymentSteps,
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

  await writeAudit("process.deploy", { actor, ip }, {
    processName,
    success: result.success,
    details: result.success
      ? {
          branch: branch || null,
          restartMode,
          installDependencies: Boolean(result.data?.installDependencies),
          runBuild: Boolean(result.data?.runBuild)
        }
      : null,
    error: result.success ? null : result.error || "deploy failed"
  });

  return result;
}

async function getDeploymentHistory(limitOrOptions = 100, processName = "") {
  if (typeof limitOrOptions === "object" && limitOrOptions !== null) {
    const pageData = await listDeploymentHistoryPage(limitOrOptions);
    return { success: true, data: pageData, error: null };
  }
  const history = await listDeploymentHistory(limitOrOptions, processName);
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

async function gitPullProcess(name) {
  const processName = sanitizeProcessName(name, "process name");
  const result = await withPM2(async () => {
    const { cwd } = await resolveProcessWorkingDirectory(processName);

    await runCommand("git", ["rev-parse", "--is-inside-work-tree"], cwd);
    const beforeHead = await runCommand("git", ["rev-parse", "--short", "HEAD"], cwd);
    const pull = await runCommand("git", ["pull"], cwd);
    const afterHead = await runCommand("git", ["rev-parse", "--short", "HEAD"], cwd);
    return {
      processName,
      cwd,
      beforeCommit: String(beforeHead.stdout || "").trim(),
      afterCommit: String(afterHead.stdout || "").trim(),
      output: compactOutput(`${pull.stdout || ""}\n${pull.stderr || ""}`)
    };
  });

  trackPm2Operation("processes.git.pull", result.success);
  return result;
}

/**
 * @param {string} name
 * @param {{ targetCommit?: string, restartMode?: "restart"|"reload" }} [options]
 * @param {string|{actor?:string,ip?:string}} [actorContext]
 */
async function rollbackProcess(name, options = {}, actorContext = "unknown") {
  const processName = sanitizeProcessName(name, "process name");
  const { actor, ip } = normalizeActorContext(actorContext);
  let targetCommit = "";
  try {
    targetCommit = sanitizeGitRef(options.targetCommit, "targetCommit", { allowEmpty: true });
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error.message || "Invalid rollback options"
    };
  }
  const restartMode = String(options.restartMode || "restart").trim() === "reload" ? "reload" : "restart";
  /** @type {CommandStep[]} */
  const rollbackSteps = [];

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

    const steps = rollbackSteps;
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

    try {
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
    } catch (error) {
      throw new Error(buildStepFailureMessage("Rollback failed", steps, error?.message || ""));
    }
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
    steps: result.success ? result.data.steps : rollbackSteps,
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

  await writeAudit("process.rollback", { actor, ip }, {
    processName,
    success: result.success,
    details: result.success
      ? {
          fromCommit: result.data?.fromCommit || null,
          toCommit: result.data?.toCommit || null,
          restartMode
        }
      : null,
    error: result.success ? null : result.error || "rollback failed"
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
      alertThresholds: { cpu: null, memoryMB: null },
      healthCheck: {
        enabled: false,
        protocol: "http",
        port: null,
        path: "/",
        intervalSec: 30,
        timeoutMs: 5000,
        failureThreshold: 3,
        successThreshold: 1,
        gracePeriodSec: 15
      }
    };
    const cwd = String(proc?.cwd || "").trim();
    const allowedRoot = getDotEnvAllowedRoot();
    const hasDotEnvFile = cwd && isPathInside(allowedRoot, cwd)
      ? await pathIsReadableFile(path.join(cwd, ".env"))
      : false;
    const npmCapabilities = await readNpmCapabilities(cwd);

    return {
      ...proc,
      meta,
      hasDotEnvFile,
      npmCapabilities
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

async function getInterpreterCatalog() {
  const interpreters = await Promise.all(
    INTERPRETER_CATALOG.map(async (entry) => {
      const [detected, installer] = await Promise.all([
        detectInterpreter(entry),
        getInterpreterInstallerStatus(entry.key)
      ]);
      return {
        ...detected,
        installer
      };
    })
  );
  const nodeRuntime = await getNodeRuntimeCatalog();
  return {
    success: true,
    data: {
      interpreters,
      nodeRuntime,
      totals: {
        supported: INTERPRETER_CATALOG.length,
        installed: interpreters.filter((item) => item.installed).length
      }
    },
    error: null
  };
}

async function installInterpreterRuntime(payload = {}) {
  const key = String(payload?.key || "").trim().toLowerCase();
  if (!key) {
    return { success: false, data: null, error: "key is required" };
  }
  const target = INTERPRETER_CATALOG.find((item) => item.key === key);
  if (!target) {
    return { success: false, data: null, error: `Unsupported interpreter key: ${key}` };
  }

  try {
    const installResult = await installInterpreter(key);
    const [detected, installer] = await Promise.all([
      detectInterpreter(target),
      getInterpreterInstallerStatus(target.key)
    ]);
    return {
      success: true,
      data: {
        key,
        installResult,
        interpreter: {
          ...detected,
          installer
        }
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error?.message || `Failed to install interpreter: ${key}`
    };
  }
}

async function getNodeRuntimeStatus() {
  const catalog = await getNodeRuntimeCatalog();
  return {
    success: true,
    data: catalog,
    error: null
  };
}

async function installNodeRuntime(payload = {}) {
  const version = normalizeVersion(payload?.version);
  if (!version) {
    return { success: false, data: null, error: "version is required" };
  }
  const preferredManager = String(payload?.manager || "").trim().toLowerCase();
  try {
    const installed = await installNodeRuntimeVersion(version, preferredManager);
    const catalog = await getNodeRuntimeCatalog();
    return {
      success: true,
      data: {
        installed,
        catalog
      },
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error?.message || "Failed to install requested Node version"
    };
  }
}

async function updateProcessMetadata(name, payload) {
  try {
    const nextMeta = await setProcessMeta(name, payload || {});
    return {
      success: true,
      data: nextMeta,
      error: null
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error?.message || "Failed to update process metadata"
    };
  }
}

async function removeProcessMetadata(name) {
  await clearProcessMeta(name);
  return { success: true, data: { removed: true }, error: null };
}

async function readProcessMetrics(name, limit) {
  const points = await getMetricsHistory(name, limit);
  return { success: true, data: points, error: null };
}

async function readProcessHealth(name, limit) {
  const processName = sanitizeProcessName(name, "process name");
  const [report, meta] = await Promise.all([
    getHealthReport(processName, limit),
    listProcessMeta()
  ]);
  const healthCheck = meta[processName]?.healthCheck || {};
  return {
    success: true,
    data: {
      ...report,
      summary: {
        enabled: Boolean(healthCheck.enabled),
        protocol: healthCheck.protocol || "http",
        port: healthCheck.port ?? null,
        path: healthCheck.path || "/",
        ...report.summary
      }
    },
    error: null
  };
}

async function readMonitoringSummary() {
  const live = await listProcesses();
  if (!live.success) {
    return live;
  }
  const meta = await listProcessMeta();
  const summary = await getMonitoringSummary(live.data, meta);
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
  readSystemResources,
  npmInstall,
  npmBuild,
  updateProcessSchedule,
  duplicateProcess,
  updateProcessMetadata,
  removeProcessMetadata,
  readProcessMetrics,
  readProcessHealth,
  readMonitoringSummary,
  exportProcessConfig,
  importProcessConfig,
  deployProcess,
  getDeploymentHistory,
  getGitCommitsForProcess,
  gitPullProcess,
  rollbackProcess,
  getInterpreterCatalog,
  installInterpreterRuntime,
  getNodeRuntimeStatus,
  installNodeRuntime,
  readProcessDotEnv,
  updateProcessDotEnv
};


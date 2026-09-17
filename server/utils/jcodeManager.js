const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const permissionHints = require("./permissionHints.js");
const withPermissionHint = typeof permissionHints?.withPermissionHint === "function"
  ? permissionHints.withPermissionHint
  : (message) => String(message || "Operation failed");

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;

const INSTALL_TIMEOUT_MS = Number.isFinite(Number(process.env.JCODE_INSTALL_TIMEOUT_MS))
  ? Math.max(30_000, Math.floor(Number(process.env.JCODE_INSTALL_TIMEOUT_MS)))
  : 10 * 60 * 1000;

const STATE_PATH = path.resolve(
  process.env.JCODE_STATE_PATH || path.resolve(__dirname, "../../logs/jcode-extension.json")
);

function pathDelimiter() {
  return process.platform === "win32" ? ";" : ":";
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || "";
}

function getCurrentUid() {
  try {
    if (typeof process.getuid === "function") {
      return process.getuid();
    }
  } catch (_error) {
    // Ignore UID lookup failures on non-Unix platforms.
  }

  try {
    const user = os.userInfo();
    if (Number.isInteger(user?.uid)) {
      return user.uid;
    }
  } catch (_error) {
    // os.userInfo can fail in restricted containers.
  }

  return "user";
}

function directoryExists(directoryPath) {
  try {
    return Boolean(directoryPath) && fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

function getJcodeRuntimeDir(baseEnv = process.env) {
  const explicit = String(baseEnv.JCODE_RUNTIME_DIR || "").trim();
  if (explicit) {
    return path.resolve(explicit.replace(/^~/, getHomeDir()));
  }

  const runtimeDir = String(baseEnv.XDG_RUNTIME_DIR || "").trim();
  if (runtimeDir && directoryExists(runtimeDir)) {
    return runtimeDir;
  }

  return path.join(os.tmpdir(), `pm2-manager-jcode-runtime-${getCurrentUid()}`);
}

function ensureJcodeRuntimeDir(baseEnv = process.env) {
  if (process.platform === "win32") {
    return null;
  }

  const runtimeDir = getJcodeRuntimeDir(baseEnv);
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(runtimeDir, 0o700);
  } catch (_error) {
    // chmod is best-effort; some mounted filesystems do not support it.
  }
  return runtimeDir;
}

function getJcodeSocketPath(env = process.env) {
  const runtimeDir = ensureJcodeRuntimeDir(env);
  return runtimeDir ? path.join(runtimeDir, "jcode.sock") : null;
}

function isSocketReady(socketPath) {
  if (!socketPath) {
    return false;
  }

  try {
    const stat = fs.statSync(socketPath);
    return typeof stat.isSocket === "function" ? stat.isSocket() : stat.isFile();
  } catch (_error) {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJcodeSocket(socketPath, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (isSocketReady(socketPath)) {
      return true;
    }
    await sleep(250);
  }
  return isSocketReady(socketPath);
}

function getJcodeCandidateDirs() {
  const homeDir = getHomeDir();
  const candidates = [
    process.env.JCODE_BIN_DIR,
    process.env.JCODE_HOME ? path.join(process.env.JCODE_HOME, "bin") : null,
    homeDir ? path.join(homeDir, ".local", "bin") : null,
    homeDir ? path.join(homeDir, "bin") : null,
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin"
  ];

  if (process.platform === "win32") {
    candidates.push(
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "jcode") : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, "jcode") : null
    );
  }

  return uniqueValues(candidates);
}

function withJcodePathEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  const currentPath = String(env[pathKey] || "");
  env[pathKey] = uniqueValues([...getJcodeCandidateDirs(), ...currentPath.split(pathDelimiter())]).join(pathDelimiter());

  if (process.platform !== "win32") {
    env.XDG_RUNTIME_DIR = ensureJcodeRuntimeDir(env);
  }

  return env;
}

function getJcodeBinaryCandidates() {
  const explicit = process.env.JCODE_BIN_PATH || process.env.JCODE_BINARY || "";
  const binaryName = process.platform === "win32" ? "jcode.exe" : "jcode";
  return uniqueValues([
    explicit,
    ...getJcodeCandidateDirs().map((dir) => path.join(dir, binaryName))
  ]);
}

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function getPlatformName() {
  if (process.platform === "win32") {
    return "windows";
  }
  if (process.platform === "darwin") {
    return "macos";
  }
  return "linux";
}

function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    timeoutMs = COMMAND_TIMEOUT_MS,
    allowNonZero = false,
    env = process.env
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // Process may have already exited.
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_error) {
          // Windows does not support SIGKILL; best effort only.
        }
      }, 2000).unref?.();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
        return;
      }
      if (code !== 0 && !allowNonZero) {
        const message = `Command failed (${command} ${args.join(" ")}), exit code ${code}${
          stderr ? `: ${stderr.trim()}` : ""
        }`;
        reject(new Error(withPermissionHint(message, { command, args })));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

async function commandExists(command) {
  return Boolean(await commandPath(command));
}

async function commandPath(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const result = await runCommand(probe, [command], { env: withJcodePathEnv() });
    return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || null;
  } catch (_error) {
    return null;
  }
}

async function resolveJcodeBinary() {
  const pathResult = await commandPath("jcode");
  if (pathResult) {
    return pathResult;
  }

  const candidate = getJcodeBinaryCandidates().find(fileExists);
  return candidate || null;
}

async function readState() {
  try {
    const raw = await fs.promises.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

async function writeState(nextState) {
  await fs.promises.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.promises.writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
}

function isPidRunning(pid) {
  const normalized = Number(pid);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return false;
  }
  try {
    process.kill(normalized, 0);
    return true;
  } catch (_error) {
    return false;
  }
}

function getGatewayUrl(port) {
  const override = String(process.env.JCODE_GATEWAY_URL || "").trim();
  if (override) {
    return override;
  }

  const host = String(process.env.JCODE_GATEWAY_PUBLIC_HOST || "").trim() || os.hostname() || "localhost";
  return `http://${host}:${port}`;
}

function normalizePort(value) {
  const port = Number(value || process.env.JCODE_GATEWAY_PORT || 7643);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Gateway port must be between 1 and 65535");
  }
  return port;
}

function sanitizeOutput(value) {
  return String(value || "").trim().slice(-4000);
}

async function getJcodeStatus() {
  const platform = getPlatformName();
  const binaryPath = await resolveJcodeBinary();
  const installed = Boolean(binaryPath);
  const state = await readState();
  const gatewayPid = Number(state.gatewayPid || 0) || null;
  const gatewayRunning = gatewayPid ? isPidRunning(gatewayPid) : false;
  const gatewayPort = normalizePort(state.gatewayPort || process.env.JCODE_GATEWAY_PORT || 7643);

  let version = null;
  if (installed) {
    try {
      const result = await runCommand(binaryPath, ["--version"], {
        timeoutMs: 10_000,
        allowNonZero: true,
        env: withJcodePathEnv()
      });
      version = sanitizeOutput(result.stdout || result.stderr).split(/\r?\n/)[0] || null;
    } catch (_error) {
      version = null;
    }
  }

  return {
    success: true,
    data: {
      platform,
      installed,
      available: installed,
      version,
      binaryPath,
      installSupported: ["linux", "macos", "windows"].includes(platform),
      gateway: {
        running: gatewayRunning,
        pid: gatewayRunning ? gatewayPid : null,
        port: gatewayPort,
        url: getGatewayUrl(gatewayPort)
      },
      runtime: {
        dir: process.platform === "win32" ? null : getJcodeRuntimeDir(),
        socketPath: process.platform === "win32" ? null : getJcodeSocketPath(withJcodePathEnv()),
        serverPid: state.jcodeServerPid && isPidRunning(state.jcodeServerPid) ? state.jcodeServerPid : null
      },
      lastAction: state.lastAction || null,
      lastOutput: state.lastOutput || ""
    },
    error: null
  };
}

function buildInstallRunner(platform) {
  if (platform === "windows") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://jcode.sh/install.ps1 | iex"]
    };
  }

  return {
    command: "bash",
    args: ["-lc", "curl -fsSL https://jcode.sh/install | bash"]
  };
}

async function installJcode(payload = {}) {
  const confirmation = String(payload.confirmation || "").trim();
  if (confirmation !== "INSTALL_JCODE") {
    return {
      success: false,
      data: null,
      error: "Confirmation required"
    };
  }

  const before = await getJcodeStatus();
  if (before.data?.installed) {
    return {
      success: true,
      data: {
        alreadyInstalled: true,
        status: before.data
      },
      error: null
    };
  }

  const platform = getPlatformName();
  const runner = buildInstallRunner(platform);
  try {
    const result = await runCommand(runner.command, runner.args, {
      timeoutMs: INSTALL_TIMEOUT_MS,
      env: withJcodePathEnv()
    });
    const after = await getJcodeStatus();
    const nextState = await readState();
    nextState.lastAction = {
      action: "install",
      ok: after.data?.installed || false,
      at: Date.now()
    };
    nextState.lastOutput = sanitizeOutput(result.stdout || result.stderr);
    await writeState(nextState);

    return {
      success: Boolean(after.data?.installed),
      data: {
        alreadyInstalled: false,
        status: after.data,
        output: sanitizeOutput(result.stdout || result.stderr)
      },
      error: after.data?.installed ? null : "JCode installer finished, but PM2 Manager could not find the jcode binary in PATH or common install locations"
    };
  } catch (error) {
    const nextState = await readState();
    nextState.lastAction = {
      action: "install",
      ok: false,
      at: Date.now()
    };
    nextState.lastOutput = sanitizeOutput(error?.message || "Install failed");
    await writeState(nextState);
    return {
      success: false,
      data: null,
      error: error?.message || "JCode install failed"
    };
  }
}

async function startJcodeGateway(payload = {}) {
  const status = await getJcodeStatus();
  if (!status.data?.installed) {
    return {
      success: false,
      data: null,
      error: "Install JCode first"
    };
  }

  const currentState = await readState();
  if (currentState.gatewayPid && isPidRunning(currentState.gatewayPid)) {
    return {
      success: true,
      data: {
        alreadyRunning: true,
        status: status.data
      },
      error: null
    };
  }

  const port = normalizePort(payload.port || process.env.JCODE_GATEWAY_PORT || 7643);
  const serverName = String(payload.serverName || process.env.JCODE_SERVER_NAME || "pm2-manager").trim() || "pm2-manager";
  const binaryPath = await resolveJcodeBinary();
  if (!binaryPath) {
    return {
      success: false,
      data: null,
      error: "Install JCode first"
    };
  }

  const args = ["serve", "--server-name", serverName];
  const child = spawn(binaryPath, args, {
    cwd: process.env.JCODE_WORKING_DIR || process.cwd(),
    env: withJcodePathEnv({
      ...process.env,
      JCODE_GATEWAY_PORT: String(port)
    }),
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.on("error", () => {
    // The status endpoint will surface failures on the next refresh.
  });
  child.unref();

  const nextState = {
    ...currentState,
    gatewayPid: child.pid,
    gatewayPort: port,
    lastAction: {
      action: "start-gateway",
      ok: true,
      at: Date.now()
    },
    lastOutput: `Started jcode serve with PID ${child.pid}`
  };
  await writeState(nextState);

  const nextStatus = await getJcodeStatus();
  return {
    success: true,
    data: {
      alreadyRunning: false,
      status: nextStatus.data
    },
    error: null
  };
}

async function stopJcodeGateway() {
  const state = await readState();
  const pid = Number(state.gatewayPid || 0);
  if (!pid || !isPidRunning(pid)) {
    const nextState = {
      ...state,
      gatewayPid: null,
      lastAction: {
        action: "stop-gateway",
        ok: true,
        at: Date.now()
      },
      lastOutput: "JCode gateway was not running"
    };
    await writeState(nextState);
    return {
      success: true,
      data: {
        stopped: false,
        status: (await getJcodeStatus()).data
      },
      error: null
    };
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error?.message || "Unable to stop JCode gateway"
    };
  }

  const nextState = {
    ...state,
    gatewayPid: null,
    lastAction: {
      action: "stop-gateway",
      ok: true,
      at: Date.now()
    },
    lastOutput: `Stopped JCode gateway PID ${pid}`
  };
  await writeState(nextState);

  return {
    success: true,
    data: {
      stopped: true,
      status: (await getJcodeStatus()).data
    },
    error: null
  };
}

async function runJcodeAction(payload = {}) {
  const action = String(payload.action || "").trim();
  const status = await getJcodeStatus();
  if (!status.data?.installed) {
    return {
      success: false,
      data: null,
      error: "Install JCode first"
    };
  }

  const allowed = {
    "smoke-test": ["run", "say hello"],
    "auth-test": ["auth-test"],
    "pair-device": ["pair"],
    "list-pairs": ["pair", "--list"]
  };
  const args = allowed[action];
  if (!args) {
    return {
      success: false,
      data: null,
      error: "Unsupported JCode action"
    };
  }

  try {
    const binaryPath = await resolveJcodeBinary();
    if (!binaryPath) {
      return {
        success: false,
        data: null,
        error: "Install JCode first"
      };
    }

    const result = await runCommand(binaryPath, args, {
      cwd: process.env.JCODE_WORKING_DIR || process.cwd(),
      timeoutMs: action === "smoke-test" ? 60_000 : COMMAND_TIMEOUT_MS,
      allowNonZero: true,
      env: withJcodePathEnv()
    });
    const output = sanitizeOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
    const ok = result.code === 0;
    const nextState = await readState();
    nextState.lastAction = {
      action,
      ok,
      at: Date.now()
    };
    nextState.lastOutput = output;
    await writeState(nextState);

    return {
      success: ok,
      data: {
        action,
        code: result.code,
        output,
        status: (await getJcodeStatus()).data
      },
      error: ok ? null : output || "JCode action failed"
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: error?.message || "JCode action failed"
    };
  }
}


async function ensureJcodeServer(binaryPath, cwd, env) {
  if (process.platform === "win32") {
    return { success: true, started: false, socketPath: null, message: "" };
  }

  const socketPath = getJcodeSocketPath(env);
  if (isSocketReady(socketPath)) {
    return {
      success: true,
      started: false,
      socketPath,
      message: `Using JCode server socket ${socketPath}.`
    };
  }

  const serverName = String(process.env.JCODE_SERVER_NAME || "pm2-manager").trim() || "pm2-manager";
  const child = spawn(binaryPath, ["serve", "--server-name", serverName], {
    cwd,
    env,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  const startTimeoutMs = Number.isFinite(Number(process.env.JCODE_SERVER_START_TIMEOUT_MS))
    ? Math.max(2000, Math.floor(Number(process.env.JCODE_SERVER_START_TIMEOUT_MS)))
    : 12_000;
  const ready = await waitForJcodeSocket(socketPath, startTimeoutMs);
  const state = await readState();
  const nextState = {
    ...state,
    jcodeServerPid: child.pid,
    lastAction: {
      action: "terminal-server-start",
      ok: ready,
      at: Date.now()
    },
    lastOutput: ready
      ? `Started JCode server PID ${child.pid} at ${socketPath}`
      : `JCode server PID ${child.pid} did not create ${socketPath} before timeout`
  };
  await writeState(nextState);

  if (!ready) {
    return {
      success: false,
      started: true,
      socketPath,
      message: "",
      error: `JCode server did not become ready. Expected socket: ${socketPath}`
    };
  }

  return {
    success: true,
    started: true,
    socketPath,
    message: `Started JCode server PID ${child.pid} at ${socketPath}.`
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function normalizeTerminalSize(value, fallback, min, max) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(normalized)));
}

function normalizeTerminalMode(value) {
  const mode = String(value || "start").trim().toLowerCase();
  return ["start", "connect", "resume"].includes(mode) ? mode : "start";
}

function resolveTerminalCwd(value) {
  const requested = String(value || process.env.JCODE_WORKING_DIR || "").trim();
  const fallback = process.cwd();
  if (!requested) {
    return fallback;
  }

  const resolved = path.resolve(requested.replace(/^~/, os.homedir()));
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : fallback;
  } catch (_error) {
    return fallback;
  }
}

async function createJcodeTerminalProcess(payload = {}) {
  const binaryPath = await resolveJcodeBinary();
  if (!binaryPath) {
    return {
      success: false,
      child: null,
      error: "Install JCode first"
    };
  }

  const mode = normalizeTerminalMode(payload.mode);
  const resumeName = String(payload.resume || "").trim();

  const cols = normalizeTerminalSize(payload.cols, 100, 40, 240);
  const rows = normalizeTerminalSize(payload.rows, 30, 12, 80);
  const cwd = resolveTerminalCwd(payload.cwd);
  const env = withJcodePathEnv({
    ...process.env,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
    COLUMNS: String(cols),
    LINES: String(rows),
    FORCE_COLOR: process.env.FORCE_COLOR || "1"
  });

  const args = [];
  let prelude = "";
  if (mode === "start" || mode === "connect") {
    const server = await ensureJcodeServer(binaryPath, cwd, env);
    if (!server.success) {
      return {
        success: false,
        child: null,
        error: `${server.error || "JCode server failed to start"}. Try setting JCODE_RUNTIME_DIR to a writable folder and restart PM2 Manager.`
      };
    }
    prelude = server.message || "";
    args.push("connect");
  } else if (mode === "resume" && resumeName) {
    const server = await ensureJcodeServer(binaryPath, cwd, env);
    if (!server.success) {
      return {
        success: false,
        child: null,
        error: `${server.error || "JCode server failed to start"}. Try setting JCODE_RUNTIME_DIR to a writable folder and restart PM2 Manager.`
      };
    }
    prelude = server.message || "";
    args.push("--resume", resumeName.slice(0, 80));
  }

  let command = binaryPath;
  let spawnArgs = args;
  let pty = false;
  let label = [binaryPath, ...args].join(" ");

  // JCode is a terminal UI. On Linux, util-linux `script` gives it a real pseudo-terminal
  // without adding a native node-pty dependency to PM2 Manager.
  const scriptPath = process.platform === "linux" ? await commandPath("script") : null;
  if (scriptPath) {
    pty = true;
    command = scriptPath;
    const terminalCommand = [binaryPath, ...args].map(shellQuote).join(" ");
    spawnArgs = ["-qfec", terminalCommand, "/dev/null"];
    label = terminalCommand;
  }

  try {
    const child = spawn(command, spawnArgs, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    return {
      success: true,
      child,
      error: null,
      meta: {
        pid: child.pid,
        pty,
        command: label,
        cwd,
        rows,
        cols,
        mode,
        prelude,
        socketPath: process.platform === "win32" ? null : getJcodeSocketPath(env)
      }
    };
  } catch (error) {
    return {
      success: false,
      child: null,
      error: error?.message || "Unable to start JCode terminal"
    };
  }
}

module.exports = {
  getJcodeStatus,
  installJcode,
  startJcodeGateway,
  stopJcodeGateway,
  runJcodeAction,
  resolveJcodeBinary,
  withJcodePathEnv,
  createJcodeTerminalProcess,
  getJcodeRuntimeDir,
  getJcodeSocketPath
};

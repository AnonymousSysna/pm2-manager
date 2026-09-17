const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const { toSpawnTarget, terminateChildTree } = require("./commandSpawn");
const permissionHints = require("./permissionHints.js");
const withPermissionHint = typeof permissionHints?.withPermissionHint === "function"
  ? permissionHints.withPermissionHint
  : (message) => String(message || "Operation failed");

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;

let ptyLibrary = null;
let ptyLibraryChecked = false;
let ptyLibraryError = null;

// jcode is a full-screen terminal UI: it needs a real pseudo-terminal, not plain
// pipes. Without a PTY it cannot enter raw mode, so `/login` prompts and the chat
// composer silently swallow input. node-pty provides ConPTY on Windows and
// forkpty on Linux/macOS, so the browser terminal can host the genuine TUI.
function loadPtyLibrary() {
  if (ptyLibraryChecked) {
    return ptyLibrary;
  }
  ptyLibraryChecked = true;

  if (isTruthy(process.env.JCODE_DISABLE_PTY)) {
    ptyLibraryError = "Disabled by JCODE_DISABLE_PTY";
    return null;
  }

  try {
    // eslint-disable-next-line global-require
    ptyLibrary = require("node-pty");
  } catch (error) {
    ptyLibrary = null;
    ptyLibraryError = error?.message || String(error);
  }

  return ptyLibrary;
}

function getPtyAvailability() {
  const library = loadPtyLibrary();
  return {
    available: Boolean(library),
    backend: library ? "node-pty" : null,
    error: library ? null : ptyLibraryError
  };
}

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

function isWritableDirectory(directoryPath) {
  if (!directoryExists(directoryPath)) {
    return false;
  }

  const probePath = path.join(directoryPath, `.pm2-manager-jcode-write-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(probePath, "ok", { mode: 0o600 });
    fs.unlinkSync(probePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function resolveRuntimePath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (raw === "~") {
    return getHomeDir();
  }

  if (raw.startsWith("~/")) {
    return path.join(getHomeDir(), raw.slice(2));
  }

  return path.resolve(raw);
}

function getDefaultJcodeRuntimeDir() {
  return path.join(os.tmpdir(), `pm2-manager-jcode-runtime-${getCurrentUid()}`);
}

function shouldUseSystemRuntimeDir(baseEnv = process.env) {
  return ["1", "true", "yes", "on"].includes(
    String(baseEnv.JCODE_USE_XDG_RUNTIME_DIR || "").trim().toLowerCase()
  );
}

function getJcodeRuntimeDir(baseEnv = process.env) {
  const explicit = resolveRuntimePath(baseEnv.JCODE_RUNTIME_DIR);
  if (explicit) {
    return explicit;
  }

  // PM2/root services often inherit /run/user/0, but that runtime socket can be
  // stale or unusable after process restarts. Prefer a PM2 Manager-owned runtime
  // directory unless the operator explicitly opts into the system XDG runtime dir.
  const xdgRuntimeDir = resolveRuntimePath(baseEnv.XDG_RUNTIME_DIR);
  if (shouldUseSystemRuntimeDir(baseEnv) && xdgRuntimeDir && isWritableDirectory(xdgRuntimeDir)) {
    return xdgRuntimeDir;
  }

  return getDefaultJcodeRuntimeDir();
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

  if (!isWritableDirectory(runtimeDir)) {
    throw new Error(`JCode runtime directory is not writable: ${runtimeDir}`);
  }

  return runtimeDir;
}

function getJcodeSocketPath(env = process.env) {
  const runtimeDir = ensureJcodeRuntimeDir(env);
  return runtimeDir ? path.join(runtimeDir, "jcode.sock") : null;
}

function getJcodeRuntimeArtifactPaths(socketPath) {
  if (!socketPath) {
    return [];
  }

  const runtimeDir = path.dirname(socketPath);
  return [
    socketPath,
    path.join(runtimeDir, "jcode-debug.sock"),
    path.join(runtimeDir, "jcode-daemon.lock")
  ];
}

function getSocketState(socketPath) {
  if (!socketPath) {
    return { exists: false, socket: false };
  }

  try {
    const stat = fs.statSync(socketPath);
    return {
      exists: true,
      socket: typeof stat.isSocket === "function" ? stat.isSocket() : stat.isFile()
    };
  } catch (_error) {
    return { exists: false, socket: false };
  }
}

function isSocketReady(socketPath) {
  return getSocketState(socketPath).socket;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeUnixSocket(socketPath, timeoutMs = 1000) {
  if (!socketPath || process.platform === "win32") {
    return Promise.resolve({ accepting: false, errorCode: "unsupported" });
  }

  const state = getSocketState(socketPath);
  if (!state.exists) {
    return Promise.resolve({ accepting: false, errorCode: "missing" });
  }
  if (!state.socket) {
    return Promise.resolve({ accepting: false, errorCode: "not-socket" });
  }

  return new Promise((resolve) => {
    const client = net.createConnection({ path: socketPath });
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        client.destroy();
      } catch (_error) {
        // Best-effort cleanup for a probe-only connection.
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ accepting: false, errorCode: "timeout" });
    }, Math.max(250, timeoutMs));

    client.once("connect", () => finish({ accepting: true, errorCode: null }));
    client.once("error", (error) => {
      finish({ accepting: false, errorCode: error?.code || "connect-failed" });
    });
  });
}

async function removeStaleJcodeRuntimeArtifacts(socketPath, reason = "stale") {
  const artifactPaths = getJcodeRuntimeArtifactPaths(socketPath);
  if (!artifactPaths.length) {
    return { removed: false, paths: [] };
  }

  const removedPaths = [];
  for (const artifactPath of artifactPaths) {
    try {
      const stat = await fs.promises.lstat(artifactPath);
      const basename = path.basename(artifactPath);
      const safeName = ["jcode.sock", "jcode-debug.sock", "jcode-daemon.lock"].includes(basename);
      if (!safeName || stat.isDirectory()) {
        continue;
      }
      await fs.promises.unlink(artifactPath);
      removedPaths.push(artifactPath);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        // Keep trying the remaining runtime artifacts.
      }
    }
  }

  if (removedPaths.length) {
    const nextState = await readState();
    nextState.lastAction = {
      action: "remove-stale-terminal-runtime",
      ok: true,
      at: Date.now()
    };
    nextState.lastOutput = `Removed stale JCode runtime artifacts (${reason}): ${removedPaths.join(", ")}`;
    await writeState(nextState);
  }

  return { removed: Boolean(removedPaths.length), paths: removedPaths };
}

async function removeStaleJcodeSocket(socketPath, reason = "stale") {
  const result = await removeStaleJcodeRuntimeArtifacts(socketPath, reason);
  return result.removed;
}

async function waitForJcodeSocket(socketPath, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const probe = await probeUnixSocket(socketPath, 500);
    if (probe.accepting) {
      return true;
    }
    await sleep(250);
  }
  return (await probeUnixSocket(socketPath, 500)).accepting;
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
    const runtimeDir = ensureJcodeRuntimeDir(env);
    env.JCODE_RUNTIME_DIR = runtimeDir;
    env.XDG_RUNTIME_DIR = runtimeDir;
    env.JCODE_SOCKET = path.join(runtimeDir, "jcode.sock");
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
    // An installed `jcode.cmd` or a package manager shim cannot be spawn'd
    // directly on Windows; toSpawnTarget decides when the shell is required.
    const target = toSpawnTarget(command, args);
    const child = spawn(target.command, target.args, {
      windowsVerbatimArguments: target.windowsVerbatimArguments,
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
      terminateChildTree(child);
      setTimeout(() => terminateChildTree(child), 2000).unref?.();
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


function getJcodeConfigPath() {
  const homeDir = getHomeDir();
  if (!homeDir) {
    return null;
  }
  return path.join(process.env.JCODE_HOME || path.join(homeDir, ".jcode"), "config.toml");
}

// The gateway (HTTP /health, POST /pair, ws /ws) is opt-in through
// [gateway] enabled = true in the JCode config, so PM2 Manager has to read the
// real config instead of assuming the daemon exposes it.
function readJcodeGatewayConfig() {
  const configPath = getJcodeConfigPath();
  if (!configPath) {
    return { configPath: null, enabled: false, port: null, bindAddr: null };
  }

  let raw = "";
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (_error) {
    return { configPath, enabled: false, port: null, bindAddr: null };
  }

  const result = { configPath, enabled: false, port: null, bindAddr: null };
  let inGatewaySection = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      inGatewaySection = section[1].trim() === "gateway";
      continue;
    }
    if (!inGatewaySection) {
      continue;
    }
    const entry = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!entry) {
      continue;
    }
    const key = entry[1];
    const value = entry[2].trim().replace(/^["']|["']$/g, "");
    if (key === "enabled") {
      result.enabled = isTruthy(value);
    } else if (key === "port") {
      const port = Number(value);
      result.port = Number.isInteger(port) ? port : null;
    } else if (key === "bind_addr") {
      result.bindAddr = value || null;
    }
  }

  return result;
}

function probeGatewayHttp(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const request = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: Math.max(250, timeoutMs) },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString("utf8").slice(0, 2000);
        });
        response.on("end", () => {
          finish({ reachable: true, statusCode: response.statusCode || null, body });
        });
      }
    );
    request.on("timeout", () => {
      request.destroy();
      finish({ reachable: false, statusCode: null, body: "" });
    });
    request.on("error", () => {
      finish({ reachable: false, statusCode: null, body: "" });
    });
  });
}

function getJcodeOperatorInfo() {
  let user = null;
  let uid = null;
  try {
    const info = os.userInfo();
    user = info?.username || null;
    uid = Number.isInteger(info?.uid) ? info.uid : null;
  } catch (_error) {
    // Restricted containers can block os.userInfo().
  }

  const currentUid = getCurrentUid();
  const normalizedUid = Number.isInteger(uid) ? uid : Number(currentUid);
  const isRoot = normalizedUid === 0 || String(user || "").toLowerCase() === "root";
  return {
    user: user || process.env.USER || process.env.USERNAME || null,
    uid: Number.isInteger(normalizedUid) ? normalizedUid : currentUid,
    isRoot,
    cwd: process.cwd(),
    shell: process.env.SHELL || process.env.ComSpec || null,
    customCommandsAllowed: isRoot || isTruthy(process.env.JCODE_ALLOW_CUSTOM_TERMINAL)
  };
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

async function getJcodeStatus() {
  const platform = getPlatformName();
  const binaryPath = await resolveJcodeBinary();
  const installed = Boolean(binaryPath);
  const state = await readState();
  const ptyAvailability = getPtyAvailability();
  const ptyInfo = {
    ptySupported: ptyAvailability.available,
    backend: ptyAvailability.available
      ? ptyAvailability.backend
      : process.platform === "linux"
        ? "script-pty"
        : "pipes",
    error: ptyAvailability.error || null
  };
  const gatewayPid = Number(state.gatewayPid || 0) || null;
  const gatewayConfig = readJcodeGatewayConfig();
  const gatewayPort = normalizePort(
    process.env.JCODE_GATEWAY_PORT || gatewayConfig.port || state.gatewayPort || 7643
  );
  const gatewayProbe = await probeGatewayHttp(gatewayPort, Number(process.env.JCODE_GATEWAY_PROBE_TIMEOUT_MS) || 800);
  const gatewayPidRunning = gatewayPid ? isPidRunning(gatewayPid) : false;
  const gatewayRunning = gatewayProbe.reachable || gatewayPidRunning;
  const gatewayHint = gatewayProbe.reachable
    ? null
    : gatewayConfig.enabled
      ? `The JCode gateway is enabled in ${gatewayConfig.configPath}, but nothing answered on port ${gatewayPort}. Restart the JCode server (jcode server reload) so it binds the gateway.`
      : `The JCode gateway is disabled. Set [gateway] enabled = true in ${gatewayConfig.configPath} and restart the JCode server (jcode server reload).`;

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
        reachable: gatewayProbe.reachable,
        pid: gatewayPidRunning ? gatewayPid : null,
        port: gatewayPort,
        url: getGatewayUrl(gatewayPort),
        configPath: gatewayConfig.configPath,
        configEnabled: gatewayConfig.enabled,
        bindAddr: gatewayConfig.bindAddr,
        hint: gatewayHint
      },
      runtime: {
        dir: process.platform === "win32" ? null : getJcodeRuntimeDir(withJcodePathEnv()),
        socketPath: process.platform === "win32" ? null : getJcodeSocketPath(withJcodePathEnv()),
        serverPid: state.jcodeServerPid && isPidRunning(state.jcodeServerPid) ? state.jcodeServerPid : null,
        source: process.env.JCODE_RUNTIME_DIR
          ? "JCODE_RUNTIME_DIR"
          : shouldUseSystemRuntimeDir(process.env)
            ? "XDG_RUNTIME_DIR"
            : "pm2-manager-default"
      },
      operator: getJcodeOperatorInfo(),
      terminal: ptyInfo,
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
  if (status.data?.gateway?.reachable) {
    return {
      success: true,
      data: {
        alreadyRunning: true,
        status: status.data
      },
      error: null
    };
  }

  const port = normalizePort(
    payload.port || process.env.JCODE_GATEWAY_PORT || status.data?.gateway?.port || 7643
  );
  const gatewayConfig = readJcodeGatewayConfig();
  if (!gatewayConfig.enabled) {
    // Starting a daemon cannot expose the gateway while [gateway] enabled = false,
    // so report the real blocker instead of launching a process that cannot work.
    return {
      success: false,
      data: null,
      error: `The JCode gateway is disabled. Set [gateway] enabled = true in ${gatewayConfig.configPath} and restart the JCode server (jcode server reload), then reload this page.`
    };
  }

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
  let stdout = "";
  const launch = toSpawnTarget(binaryPath, args);
  const child = spawn(launch.command, launch.args, {
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    cwd: process.env.JCODE_WORKING_DIR || process.cwd(),
    env: withJcodePathEnv({
      ...process.env,
      JCODE_GATEWAY_PORT: String(port)
    }),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout?.on("data", (chunk) => {
    stdout = `${stdout}${chunk.toString("utf8")}`.slice(-2000);
  });
  child.stderr?.on("data", (chunk) => {
    stdout = `${stdout}${chunk.toString("utf8")}`.slice(-2000);
  });
  child.on("error", () => {
    // The status endpoint will surface failures on the next refresh.
  });
  child.unref();

  // Give the daemon a moment to bind, then report what actually happens.
  let reachable = false;
  for (let attempt = 0; attempt < 12 && !reachable; attempt += 1) {
    await sleep(250);
    reachable = (await probeGatewayHttp(port, 500)).reachable;
  }

  const nextState = {
    ...currentState,
    gatewayPid: reachable && isPidRunning(child.pid) ? child.pid : null,
    gatewayPort: port,
    lastAction: {
      action: "start-gateway",
      ok: reachable,
      at: Date.now()
    },
    lastOutput: reachable
      ? `Started jcode serve with PID ${child.pid} on port ${port}`
      : `jcode serve PID ${child.pid} did not answer on port ${port}. ${stdout.trim()}`
  };
  await writeState(nextState);

  const nextStatus = await getJcodeStatus();
  return {
    success: reachable,
    data: {
      alreadyRunning: false,
      status: nextStatus.data
    },
    error: reachable
      ? null
      : `The gateway did not answer on port ${port}. ${
          stdout.trim() ||
          "Another JCode server may already own the runtime socket; restart it with 'jcode server reload'."
        }`
  };
}

async function stopJcodeGateway() {
  const state = await readState();
  const pid = Number(state.gatewayPid || 0);
  if (!pid || !isPidRunning(pid)) {
    const status = await getJcodeStatus();
    const externallyOwned = Boolean(status.data?.gateway?.reachable);
    const nextState = {
      ...state,
      gatewayPid: null,
      lastAction: {
        action: "stop-gateway",
        ok: true,
        at: Date.now()
      },
      lastOutput: externallyOwned
        ? "JCode gateway is served by a JCode server that PM2 Manager did not start"
        : "JCode gateway was not running"
    };
    await writeState(nextState);
    return {
      success: true,
      data: {
        stopped: false,
        externallyOwned,
        status: status.data
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

  if (action === "repair-runtime") {
    try {
      const binaryPath = await resolveJcodeBinary();
      const env = withJcodePathEnv();
      const socketPath = process.platform === "win32" ? null : getJcodeSocketPath(env);
      const cleanup = socketPath
        ? await removeStaleJcodeRuntimeArtifacts(socketPath, "manual repair")
        : { removed: false, paths: [] };
      const state = await readState();
      const pid = Number(state.jcodeServerPid || 0);
      if (pid && isPidRunning(pid)) {
        try {
          process.kill(pid, "SIGTERM");
        } catch (_error) {
          // Best-effort: the next start will re-probe the socket.
        }
      }
      const output = [
        socketPath ? `Runtime socket: ${socketPath}` : "Runtime socket unavailable on this platform",
        cleanup.paths.length ? `Removed: ${cleanup.paths.join(", ")}` : "No stale runtime files found",
        pid ? `Stopped tracked JCode server PID ${pid}` : "No tracked JCode server PID",
        binaryPath ? `Binary: ${binaryPath}` : "Binary: not found"
      ].join("\n");
      const nextState = {
        ...state,
        jcodeServerPid: null,
        lastAction: { action, ok: true, at: Date.now() },
        lastOutput: output
      };
      await writeState(nextState);
      return {
        success: true,
        data: {
          action,
          output,
          binaryPath,
          status: (await getJcodeStatus()).data
        },
        error: null
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error?.message || "JCode runtime repair failed"
      };
    }
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


function summarizeProcessOutput(stdout = "", stderr = "") {
  const output = sanitizeOutput(`${stdout || ""}\n${stderr || ""}`);
  return output ? `\nJCode output:\n${output}` : "";
}

async function waitForChildExit(child, timeoutMs = 500) {
  if (!child) {
    return { exited: true, code: null, signal: null };
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ exited: false, code: null, signal: null }), Math.max(50, timeoutMs));
    child.once("close", (code, signal) => finish({ exited: true, code, signal }));
    child.once("error", (error) => finish({ exited: true, code: null, signal: error?.message || "error" }));
  });
}

async function startJcodeServerProcess(binaryPath, cwd, env) {
  const serverName = String(process.env.JCODE_SERVER_NAME || "pm2-manager").trim() || "pm2-manager";
  let stdout = "";
  let stderr = "";
  let exitState = { exited: false, code: null, signal: null };

  const launch = toSpawnTarget(binaryPath, ["serve", "--server-name", serverName]);
  const child = spawn(launch.command, launch.args, {
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout?.on("data", (chunk) => {
    stdout = sanitizeOutput(`${stdout}${chunk.toString("utf8")}`);
  });
  child.stderr?.on("data", (chunk) => {
    stderr = sanitizeOutput(`${stderr}${chunk.toString("utf8")}`);
  });
  child.once("close", (code, signal) => {
    exitState = { exited: true, code, signal };
  });
  child.once("error", (error) => {
    exitState = { exited: true, code: null, signal: error?.message || "error" };
  });

  child.unref();
  return {
    child,
    getExit: () => exitState,
    getOutput: () => ({ stdout, stderr, combined: summarizeProcessOutput(stdout, stderr) })
  };
}

async function ensureJcodeServer(binaryPath, cwd, env) {
  if (process.platform === "win32") {
    return { success: true, started: false, socketPath: null, message: "" };
  }

  const socketPath = getJcodeSocketPath(env);
  const existingProbe = await probeUnixSocket(socketPath, 1000);
  let staleSocketMessage = "";
  if (existingProbe.accepting) {
    return {
      success: true,
      started: false,
      socketPath,
      message: `Using healthy JCode server socket ${socketPath}.`
    };
  }

  const artifactPaths = getJcodeRuntimeArtifactPaths(socketPath);
  const hasRuntimeArtifacts = artifactPaths.some((artifactPath) => {
    try {
      return fs.existsSync(artifactPath);
    } catch (_error) {
      return false;
    }
  });

  if (hasRuntimeArtifacts) {
    const cleanup = await removeStaleJcodeRuntimeArtifacts(socketPath, existingProbe.errorCode || "not accepting connections");
    staleSocketMessage = cleanup.removed
      ? `Removed stale JCode runtime files (${existingProbe.errorCode || "not accepting connections"}): ${cleanup.paths.join(", ")}.`
      : `JCode runtime files near ${socketPath} were not accepting connections, but PM2 Manager could not remove them.`;
    if (!cleanup.removed && getSocketState(socketPath).socket) {
      return {
        success: false,
        started: false,
        socketPath,
        message: staleSocketMessage,
        error: `${staleSocketMessage} Stop any old jcode process or remove the socket manually, then try again.`
      };
    }
  }

  const serverStart = await startJcodeServerProcess(binaryPath, cwd, env);
  const child = serverStart.child;
  const startTimeoutMs = Number.isFinite(Number(process.env.JCODE_SERVER_START_TIMEOUT_MS))
    ? Math.max(2000, Math.floor(Number(process.env.JCODE_SERVER_START_TIMEOUT_MS)))
    : 12_000;
  const ready = await waitForJcodeSocket(socketPath, startTimeoutMs);
  const earlyExit = serverStart.getExit();
  const output = serverStart.getOutput();
  const state = await readState();
  const nextState = {
    ...state,
    jcodeServerPid: ready ? child.pid : null,
    lastAction: {
      action: "terminal-server-start",
      ok: ready,
      at: Date.now()
    },
    lastOutput: ready
      ? `Started JCode server PID ${child.pid} at ${socketPath}${output.combined}`
      : `JCode server PID ${child.pid} did not accept connections at ${socketPath} before timeout${
          earlyExit.exited ? `; process exited code=${earlyExit.code ?? ""} signal=${earlyExit.signal || ""}` : ""
        }${output.combined}`
  };
  await writeState(nextState);

  if (!ready) {
    if (!earlyExit.exited) {
      try {
        child.kill("SIGTERM");
      } catch (_error) {
        // Best-effort cleanup; a later repair can remove stale runtime files.
      }
    }

    const details = output.combined || "\nNo stderr/stdout was captured from jcode serve.";
    return {
      success: false,
      started: true,
      socketPath,
      message: staleSocketMessage,
      error: `JCode server did not accept connections at ${socketPath}.${details}`
    };
  }

  return {
    success: true,
    started: true,
    socketPath,
    message: [staleSocketMessage, `Started JCode server PID ${child.pid} at ${socketPath}.`, output.combined.trim()]
      .filter(Boolean)
      .join("\n")
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
  return ["start", "connect", "resume", "command"].includes(mode) ? mode : "start";
}

function normalizeTerminalCommand(value) {
  const command = String(value || "").replace(/\r/g, "").trim();
  if (!command) {
    return "";
  }
  if (command.length > 2000) {
    throw new Error("Terminal command is too long");
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(command)) {
    throw new Error("Terminal command contains unsupported control characters");
  }
  return command;
}

function isJcodeTerminalCommand(command) {
  return /^jcode(?:\s|$)/.test(String(command || "").trim());
}

function allowCustomTerminalCommands() {
  return getJcodeOperatorInfo().customCommandsAllowed;
}

function resolveShellExecutable() {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function buildShellSpawn(commandText) {
  if (process.platform === "win32") {
    return { command: resolveShellExecutable(), args: ["/d", "/s", "/c", commandText] };
  }
  return { command: resolveShellExecutable(), args: ["-lc", commandText] };
}

function resolveJcodeShellCommand(commandText, binaryPath) {
  const normalized = String(commandText || "").trim();
  if (!isJcodeTerminalCommand(normalized)) {
    return normalized;
  }
  return normalized.replace(/^jcode\b/, shellQuote(binaryPath));
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

// `jcode login --provider openai` style invocations can be spawned directly
// instead of through a shell, which keeps exit codes and signal handling clean.
// Quoted arguments are ambiguous to split safely, so those fall back to a shell.
function parseJcodeInvocation(commandText) {
  const normalized = String(commandText || "").trim();
  if (!isJcodeTerminalCommand(normalized) || /["']/.test(normalized)) {
    return null;
  }
  return normalized.split(/\s+/).filter(Boolean).slice(1);
}

// Uniform handle the socket bridge drives, whether the process is backed by a
// real pseudo-terminal (node-pty) or the legacy pipe/`script` bridge.
function createPtySession(ptyProcess) {
  return {
    kind: "pty",
    backend: "node-pty",
    pid: ptyProcess.pid,
    pty: true,
    write(data) {
      try {
        ptyProcess.write(data);
      } catch (_error) {
        // The PTY may already be closed.
      }
    },
    resize(cols, rows) {
      try {
        ptyProcess.resize(cols, rows);
      } catch (_error) {
        // Resizing after exit is a no-op.
      }
    },
    kill() {
      try {
        ptyProcess.kill();
      } catch (_error) {
        // Already exited.
      }
    },
    onData(handler) {
      ptyProcess.onData(handler);
    },
    onError() {
      // node-pty surfaces failures through onExit.
    },
    onExit(handler) {
      ptyProcess.onExit(({ exitCode, signal }) => handler(exitCode ?? null, signal ?? null));
    }
  };
}

function createChildProcessSession(child, { pty = false, backend = "pipes" } = {}) {
  return {
    kind: "child",
    backend,
    pid: child.pid,
    pty,
    write(data) {
      try {
        child.stdin?.write(data);
      } catch (_error) {
        // The child may have exited.
      }
    },
    resize() {
      // Pipe-backed sessions cannot be resized after spawn.
    },
    kill() {
      try {
        if (!child.killed) {
          child.kill("SIGTERM");
        }
      } catch (_error) {
        // Best-effort cleanup.
      }
    },
    forceKill() {
      try {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      } catch (_error) {
        // Windows does not support SIGKILL; best effort only.
      }
    },
    onData(handler) {
      child.stdout?.on("data", (chunk) => handler(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk) => handler(chunk.toString("utf8")));
    },
    onError(handler) {
      child.on("error", handler);
    },
    onExit(handler) {
      child.on("close", (code, signal) => handler(code, signal || null));
    }
  };
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
  let requestedCommand = "";
  try {
    requestedCommand = normalizeTerminalCommand(payload.command);
  } catch (error) {
    return {
      success: false,
      child: null,
      error: error?.message || "Invalid terminal command"
    };
  }

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
  let socketPath = process.platform === "win32" ? null : getJcodeSocketPath(env);
  let commandText = "";
  let label = "";

  if (requestedCommand) {
    const commandIsJcode = isJcodeTerminalCommand(requestedCommand);
    if (!commandIsJcode && !allowCustomTerminalCommands()) {
      return {
        success: false,
        child: null,
        error: "Custom terminal commands are disabled unless PM2 Manager is running as root or JCODE_ALLOW_CUSTOM_TERMINAL=1 is set. Use a command that starts with jcode, or enable custom terminal commands deliberately."
      };
    }

    commandText = resolveJcodeShellCommand(requestedCommand, binaryPath);
    label = requestedCommand;
    prelude = [
      socketPath ? `Runtime socket: ${socketPath}` : null,
      commandIsJcode
        ? `Starting JCode command in ${cwd}: ${requestedCommand}`
        : `Starting custom terminal command in ${cwd}: ${requestedCommand}`
    ].filter(Boolean).join("\n");
  } else if (mode === "start") {
    // Default web terminal behavior: launch the actual JCode client and let JCode
    // perform its native server bootstrap. This avoids blocking the UI when a
    // manual `jcode serve` cannot bind under PM2/root, while still forcing JCode
    // to use PM2 Manager's safe runtime directory through env.
    commandText = shellQuote(binaryPath);
    label = "jcode";
    prelude = socketPath
      ? `Starting JCode directly with runtime socket ${socketPath}. If JCode needs its daemon, it will start it itself.`
      : "Starting JCode directly.";
  } else if (mode === "connect") {
    const server = await ensureJcodeServer(binaryPath, cwd, env);
    if (server.success) {
      prelude = server.message || "";
      socketPath = server.socketPath || socketPath;
      if (socketPath) {
        args.push("--socket", socketPath);
      }
      args.push("connect");
      commandText = [binaryPath, ...args].map(shellQuote).join(" ");
      label = `jcode ${args.join(" ")}`;
    } else {
      // Do not kill the whole browser terminal just because the pre-started
      // server did not become ready. Fall back to the real JCode client so the
      // user can see JCode's own startup/login/runtime error in the terminal.
      prelude = [
        server.message,
        server.error,
        socketPath
          ? `Falling back to direct JCode launch with runtime socket ${socketPath}.`
          : "Falling back to direct JCode launch."
      ].filter(Boolean).join("\n");
      commandText = shellQuote(binaryPath);
      label = "jcode";
    }
  } else if (mode === "resume" && resumeName) {
    const safeResumeName = resumeName.slice(0, 80);
    const server = await ensureJcodeServer(binaryPath, cwd, env);
    if (server.success) {
      prelude = server.message || "";
      socketPath = server.socketPath || socketPath;
      if (socketPath) {
        args.push("--socket", socketPath);
      }
      args.push("--resume", safeResumeName);
      commandText = [binaryPath, ...args].map(shellQuote).join(" ");
      label = `jcode --resume ${safeResumeName}`;
    } else {
      prelude = [
        server.message,
        server.error,
        `Falling back to direct JCode resume for ${safeResumeName}.`
      ].filter(Boolean).join("\n");
      commandText = `${shellQuote(binaryPath)} --resume ${shellQuote(safeResumeName)}`;
      label = `jcode --resume ${safeResumeName}`;
    }
  } else {
    commandText = shellQuote(binaryPath);
    label = "jcode";
    prelude = socketPath ? `Starting JCode directly with runtime socket ${socketPath}.` : "Starting JCode directly.";
  }

  // Preferred path: a real pseudo-terminal. jcode is a full-screen TUI, so this is
  // what makes `/login` prompts, slash commands, chat input, arrow keys, and resize
  // work in the browser exactly like a native terminal.
  const ptyLibrary = loadPtyLibrary();
  if (ptyLibrary) {
    let target = null;
    if (requestedCommand) {
      const directArgs = parseJcodeInvocation(requestedCommand);
      target = directArgs ? { command: binaryPath, args: directArgs } : buildShellSpawn(commandText);
    } else {
      target = { command: binaryPath, args };
    }

    try {
      const ptyProcess = ptyLibrary.spawn(target.command, target.args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...env, TERM: "xterm-256color" },
        conptyInheritCursor: false
      });

      return {
        success: true,
        session: createPtySession(ptyProcess),
        error: null,
        meta: {
          pid: ptyProcess.pid,
          pty: true,
          backend: "node-pty",
          command: label || commandText || "jcode",
          cwd,
          rows,
          cols,
          mode: requestedCommand ? "command" : mode,
          prelude,
          socketPath,
          customCommand: Boolean(requestedCommand && !isJcodeTerminalCommand(requestedCommand)),
          operator: getJcodeOperatorInfo()
        }
      };
    } catch (error) {
      // Fall through to the legacy bridge so the operator still gets a session and
      // a visible reason instead of a dead terminal.
      prelude = [
        prelude,
        `PTY launch failed (${error?.message || "unknown error"}); falling back to the pipe bridge.`
      ].filter(Boolean).join("\n");
    }
  }

  let command;
  let spawnArgs;
  let pty = false;

  // Legacy bridge for hosts without node-pty. On Linux, util-linux `script` still
  // gives the child a real pseudo-terminal; everywhere else this degrades to pipes,
  // where interactive TUIs cannot render or accept input.
  const scriptPath = process.platform === "linux" ? await commandPath("script") : null;
  if (scriptPath) {
    pty = true;
    command = scriptPath;
    spawnArgs = ["-qfec", commandText, "/dev/null"];
  } else if (requestedCommand) {
    const shell = buildShellSpawn(commandText);
    command = shell.command;
    spawnArgs = shell.args;
  } else {
    command = binaryPath;
    spawnArgs = args;
    label = ["jcode", ...args].join(" ").trim() || "jcode";
  }

  try {
    const launch = toSpawnTarget(command, spawnArgs);
    const child = spawn(launch.command, launch.args, {
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      cwd,
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    return {
      success: true,
      session: createChildProcessSession(child, { pty, backend: pty ? "script-pty" : "pipes" }),
      error: null,
      meta: {
        pid: child.pid,
        pty,
        backend: pty ? "script-pty" : "pipes",
        command: label || commandText || "jcode",
        cwd,
        rows,
        cols,
        mode: requestedCommand ? "command" : mode,
        prelude,
        socketPath,
        customCommand: Boolean(requestedCommand && !isJcodeTerminalCommand(requestedCommand)),
        operator: getJcodeOperatorInfo()
      }
    };
  } catch (error) {
    return {
      success: false,
      session: null,
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
  getJcodeSocketPath,
  getPtyAvailability
};

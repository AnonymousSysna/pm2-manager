const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
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
        dir: process.platform === "win32" ? null : getJcodeRuntimeDir(withJcodePathEnv()),
        socketPath: process.platform === "win32" ? null : getJcodeSocketPath(withJcodePathEnv()),
        serverPid: state.jcodeServerPid && isPidRunning(state.jcodeServerPid) ? state.jcodeServerPid : null,
        source: process.env.JCODE_RUNTIME_DIR
          ? "JCODE_RUNTIME_DIR"
          : shouldUseSystemRuntimeDir(process.env)
            ? "XDG_RUNTIME_DIR"
            : "pm2-manager-default"
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

  const child = spawn(binaryPath, ["serve", "--server-name", serverName], {
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
  let socketPath = process.platform === "win32" ? null : getJcodeSocketPath(env);

  if (mode === "start") {
    // Default web terminal behavior: launch the actual JCode client and let JCode
    // perform its native server bootstrap. This avoids blocking the UI when a
    // manual `jcode serve` cannot bind under PM2/root, while still forcing JCode
    // to use PM2 Manager's safe runtime directory through env.
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
    }
  } else if (mode === "resume" && resumeName) {
    const server = await ensureJcodeServer(binaryPath, cwd, env);
    if (server.success) {
      prelude = server.message || "";
      socketPath = server.socketPath || socketPath;
      if (socketPath) {
        args.push("--socket", socketPath);
      }
      args.push("--resume", resumeName.slice(0, 80));
    } else {
      prelude = [
        server.message,
        server.error,
        `Falling back to direct JCode resume for ${resumeName.slice(0, 80)}.`
      ].filter(Boolean).join("\n");
      args.push("--resume", resumeName.slice(0, 80));
    }
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
        socketPath
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

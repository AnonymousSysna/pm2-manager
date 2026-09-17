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
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await runCommand(probe, [command]);
    return true;
  } catch (_error) {
    return false;
  }
}

async function commandPath(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const result = await runCommand(probe, [command]);
    return String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] || null;
  } catch (_error) {
    return null;
  }
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
  const installed = await commandExists("jcode");
  const state = await readState();
  const gatewayPid = Number(state.gatewayPid || 0) || null;
  const gatewayRunning = gatewayPid ? isPidRunning(gatewayPid) : false;
  const gatewayPort = normalizePort(state.gatewayPort || process.env.JCODE_GATEWAY_PORT || 7643);

  let version = null;
  let binaryPath = null;
  if (installed) {
    binaryPath = await commandPath("jcode");
    try {
      const result = await runCommand("jcode", ["--version"], { timeoutMs: 10_000, allowNonZero: true });
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
    const result = await runCommand(runner.command, runner.args, { timeoutMs: INSTALL_TIMEOUT_MS });
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
      error: after.data?.installed ? null : "JCode installer finished, but the jcode command was not found on PATH"
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
  const args = ["serve", "--server-name", serverName];
  const child = spawn("jcode", args, {
    cwd: process.env.JCODE_WORKING_DIR || process.cwd(),
    env: {
      ...process.env,
      JCODE_GATEWAY_PORT: String(port)
    },
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
    const result = await runCommand("jcode", args, {
      cwd: process.env.JCODE_WORKING_DIR || process.cwd(),
      timeoutMs: action === "smoke-test" ? 60_000 : COMMAND_TIMEOUT_MS,
      allowNonZero: true
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

module.exports = {
  getJcodeStatus,
  installJcode,
  startJcodeGateway,
  stopJcodeGateway,
  runJcodeAction
};

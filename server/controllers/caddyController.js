const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;

const MANAGED_SECTION_START = "# BEGIN PM2-MANAGER CADDY";
const MANAGED_SECTION_END = "# END PM2-MANAGER CADDY";
const MANAGED_SITES_PATH = path.resolve(
  process.env.CADDY_MANAGED_SITES_PATH || path.resolve(__dirname, "../../logs/caddy-managed-sites.json")
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

function getDefaultCaddyfilePath() {
  if (process.platform === "win32") {
    return "C:\\Caddy\\Caddyfile";
  }
  if (process.platform === "darwin") {
    return "/usr/local/etc/Caddyfile";
  }
  return "/etc/caddy/Caddyfile";
}

function getCaddyfilePath() {
  const override = String(process.env.CADDYFILE_PATH || "").trim();
  return override || getDefaultCaddyfilePath();
}

function runCommand(command, args, options = {}) {
  const { cwd = process.cwd(), timeoutMs = COMMAND_TIMEOUT_MS, allowNonZero = false } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
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
        reject(
          new Error(
            `Command failed (${command} ${args.join(" ")}), exit code ${code}${
              stderr ? `: ${stderr.trim()}` : ""
            }`
          )
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

async function commandExists(command) {
  const probeCommand = process.platform === "win32" ? "where" : "which";
  try {
    await runCommand(probeCommand, [command]);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readManagedSites() {
  try {
    const raw = await fs.promises.readFile(MANAGED_SITES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch (_error) {
    return {};
  }
}

async function writeManagedSites(sites) {
  await fs.promises.mkdir(path.dirname(MANAGED_SITES_PATH), { recursive: true });
  await fs.promises.writeFile(MANAGED_SITES_PATH, JSON.stringify(sites, null, 2), "utf8");
}

function sanitizeDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (!domain) {
    throw new Error("Domain is required");
  }
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    throw new Error("Domain must not include protocol");
  }
  if (!/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error("Invalid domain format");
  }
  return domain;
}

function sanitizeUpstream(value) {
  const upstream = String(value || "").trim();
  if (!upstream) {
    throw new Error("Upstream is required");
  }
  if (/\s/.test(upstream)) {
    throw new Error("Upstream cannot contain spaces");
  }
  const withoutProtocol = upstream.replace(/^https?:\/\//i, "");
  if (!/^[a-z0-9.-]+(?::\d{1,5})?(?:\/.*)?$/i.test(withoutProtocol)) {
    throw new Error("Invalid upstream format. Use host:port or https://host:port");
  }
  return upstream;
}

function buildManagedSection(sites) {
  const domains = Object.keys(sites).sort((a, b) => a.localeCompare(b));
  const blocks = domains.map((domain) => {
    const upstream = sites[domain];
    return `${domain} {\n  reverse_proxy ${upstream}\n}`;
  });

  return `${MANAGED_SECTION_START}\n${blocks.join("\n\n")}\n${MANAGED_SECTION_END}`;
}

async function updateCaddyfileManagedSection(caddyfilePath, sites) {
  const managedSection = buildManagedSection(sites);
  let existing = "";
  try {
    existing = await fs.promises.readFile(caddyfilePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  let next = "";
  const escapedStart = MANAGED_SECTION_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = MANAGED_SECTION_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "m");
  if (!existing.trim()) {
    next = `${managedSection}\n`;
  } else if (sectionRegex.test(existing)) {
    next = existing.replace(sectionRegex, managedSection);
  } else {
    next = `${existing.trimEnd()}\n\n${managedSection}\n`;
  }

  await fs.promises.mkdir(path.dirname(caddyfilePath), { recursive: true });
  await fs.promises.writeFile(caddyfilePath, next, "utf8");
}

async function detectCaddy() {
  const caddyInPath = await commandExists("caddy");
  if (!caddyInPath) {
    return {
      installed: false,
      available: false,
      version: null
    };
  }

  try {
    const versionResult = await runCommand("caddy", ["version"]);
    return {
      installed: true,
      available: true,
      version: String(versionResult.stdout || versionResult.stderr || "").trim() || "unknown"
    };
  } catch (_error) {
    return {
      installed: true,
      available: false,
      version: null
    };
  }
}

async function getInstallInfo() {
  const platform = getPlatformName();
  const commands = [];

  if (platform === "windows") {
    const hasWinget = await commandExists("winget");
    const hasChoco = await commandExists("choco");
    const hasScoop = await commandExists("scoop");
    if (hasWinget) {
      commands.push({ command: "winget", args: ["install", "--id", "CaddyServer.Caddy", "-e", "--source", "winget"] });
    }
    if (hasChoco) {
      commands.push({ command: "choco", args: ["install", "caddy", "-y"] });
    }
    if (hasScoop) {
      commands.push({ command: "scoop", args: ["install", "caddy"] });
    }
  } else if (platform === "macos") {
    const hasBrew = await commandExists("brew");
    if (hasBrew) {
      commands.push({ command: "brew", args: ["install", "caddy"] });
    }
  } else {
    const hasApt = await commandExists("apt-get");
    const hasDnf = await commandExists("dnf");
    const hasYum = await commandExists("yum");
    const hasPacman = await commandExists("pacman");
    const hasZypper = await commandExists("zypper");

    if (hasApt) {
      commands.push({ command: "apt-get", args: ["update"] });
      commands.push({ command: "apt-get", args: ["install", "-y", "caddy"] });
    } else if (hasDnf) {
      commands.push({ command: "dnf", args: ["install", "-y", "caddy"] });
    } else if (hasYum) {
      commands.push({ command: "yum", args: ["install", "-y", "caddy"] });
    } else if (hasPacman) {
      commands.push({ command: "pacman", args: ["-Sy", "--noconfirm", "caddy"] });
    } else if (hasZypper) {
      commands.push({ command: "zypper", args: ["--non-interactive", "install", "caddy"] });
    }
  }

  return {
    platform,
    installCommands: commands
  };
}

function getStatusPayload(caddyStatus, installInfo, sites) {
  return {
    platform: installInfo.platform,
    hostname: os.hostname(),
    caddyfilePath: getCaddyfilePath(),
    installed: caddyStatus.installed,
    available: caddyStatus.available,
    version: caddyStatus.version,
    managedSites: Object.entries(sites).map(([domain, upstream]) => ({ domain, upstream })),
    installCommands: installInfo.installCommands.map((item) => `${item.command} ${item.args.join(" ")}`)
  };
}

async function getCaddyStatus() {
  const [caddyStatus, installInfo, sites] = await Promise.all([
    detectCaddy(),
    getInstallInfo(),
    readManagedSites()
  ]);
  return {
    success: true,
    data: getStatusPayload(caddyStatus, installInfo, sites),
    error: null
  };
}

async function installCaddy() {
  const caddyStatus = await detectCaddy();
  if (caddyStatus.installed) {
    return {
      success: true,
      data: { alreadyInstalled: true, status: caddyStatus },
      error: null
    };
  }

  const installInfo = await getInstallInfo();
  const commands = installInfo.installCommands;
  if (!commands.length) {
    return {
      success: false,
      data: null,
      error: `No supported install command found for ${installInfo.platform}`
    };
  }

  const attempts = [];
  for (const entry of commands) {
    try {
      const result = await runCommand(entry.command, entry.args);
      attempts.push({
        command: `${entry.command} ${entry.args.join(" ")}`,
        success: true,
        output: String(result.stdout || result.stderr || "").trim().slice(-2000)
      });
    } catch (error) {
      attempts.push({
        command: `${entry.command} ${entry.args.join(" ")}`,
        success: false,
        error: error.message
      });
      return {
        success: false,
        data: { attempts },
        error: `Caddy install failed. ${error.message}`
      };
    }
  }

  const after = await detectCaddy();
  if (!after.installed) {
    return {
      success: false,
      data: { attempts },
      error: "Install commands completed but caddy is still not available in PATH"
    };
  }

  return {
    success: true,
    data: { attempts, status: after },
    error: null
  };
}

async function addReverseProxy(payload = {}) {
  const domain = sanitizeDomain(payload.domain);
  const upstream = sanitizeUpstream(payload.upstream);

  const status = await detectCaddy();
  if (!status.installed) {
    return {
      success: false,
      data: null,
      error: "Caddy is not installed"
    };
  }

  const caddyfilePath = getCaddyfilePath();
  const sites = await readManagedSites();
  sites[domain] = upstream;
  await writeManagedSites(sites);
  await updateCaddyfileManagedSection(caddyfilePath, sites);

  let validation = null;
  try {
    await runCommand("caddy", ["validate", "--config", caddyfilePath, "--adapter", "caddyfile"]);
    validation = { success: true, error: null };
  } catch (error) {
    validation = { success: false, error: error.message };
  }

  let reload = null;
  try {
    await runCommand("caddy", ["reload", "--config", caddyfilePath, "--adapter", "caddyfile"]);
    reload = { success: true, error: null };
  } catch (error) {
    reload = { success: false, error: error.message };
  }

  return {
    success: reload?.success || false,
    data: {
      domain,
      upstream,
      caddyfilePath,
      validation,
      reload
    },
    error: reload?.success ? null : "Saved config but failed to reload Caddy"
  };
}

async function restartCaddyService() {
  const status = await detectCaddy();
  if (!status.installed) {
    return {
      success: false,
      data: null,
      error: "Caddy is not installed"
    };
  }

  const platform = getPlatformName();
  const attempts = [];
  const restartCommands = [];

  if (platform === "linux") {
    restartCommands.push({ command: "systemctl", args: ["restart", "caddy"] });
    restartCommands.push({ command: "service", args: ["caddy", "restart"] });
  } else if (platform === "macos") {
    restartCommands.push({ command: "brew", args: ["services", "restart", "caddy"] });
  } else if (platform === "windows") {
    restartCommands.push({ command: "sc", args: ["stop", "caddy"] });
    restartCommands.push({ command: "sc", args: ["start", "caddy"] });
  }

  restartCommands.push({
    command: "caddy",
    args: ["reload", "--config", getCaddyfilePath(), "--adapter", "caddyfile"]
  });

  for (const entry of restartCommands) {
    try {
      const result = await runCommand(entry.command, entry.args);
      attempts.push({
        command: `${entry.command} ${entry.args.join(" ")}`,
        success: true,
        output: String(result.stdout || result.stderr || "").trim().slice(-2000)
      });
      if (entry.command !== "sc" || entry.args[0] !== "stop") {
        return {
          success: true,
          data: { attempts, platform },
          error: null
        };
      }
    } catch (error) {
      attempts.push({
        command: `${entry.command} ${entry.args.join(" ")}`,
        success: false,
        error: error.message
      });
    }
  }

  return {
    success: false,
    data: { attempts, platform },
    error: "Unable to restart Caddy service with available commands"
  };
}

module.exports = {
  getCaddyStatus,
  installCaddy,
  addReverseProxy,
  restartCaddyService
};

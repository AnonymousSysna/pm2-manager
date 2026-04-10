const { spawn } = require("child_process");

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;

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
  const { cwd = process.cwd(), timeoutMs = COMMAND_TIMEOUT_MS } = options;
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
      if (code !== 0) {
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
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    await runCommand(probe, [command]);
    return true;
  } catch (_error) {
    return false;
  }
}

async function isElevatedRuntime() {
  if (process.platform === "win32") {
    try {
      await runCommand("net", ["session"]);
      return true;
    } catch (_error) {
      return false;
    }
  }
  if (typeof process.getuid === "function") {
    return process.getuid() === 0;
  }
  return false;
}

function buildInstallCandidates(interpreterKey, platform) {
  const map = {
    python: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "Python.Python.3.12", "-e", "--source", "winget"]]] },
        { label: "choco", probe: "choco", steps: [["choco", ["install", "python", "-y"]]] },
        { label: "scoop", probe: "scoop", steps: [["scoop", ["install", "python"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "python"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "python3", "python3-pip"]]] },
        { label: "dnf", probe: "dnf", steps: [["dnf", ["install", "-y", "python3", "python3-pip"]]] },
        { label: "yum", probe: "yum", steps: [["yum", ["install", "-y", "python3", "python3-pip"]]] },
        { label: "pacman", probe: "pacman", steps: [["pacman", ["-Sy", "--noconfirm", "python", "python-pip"]]] },
        { label: "zypper", probe: "zypper", steps: [["zypper", ["--non-interactive", "install", "python3", "python3-pip"]]] }
      ]
    },
    php: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "PHP.PHP", "-e", "--source", "winget"]]] },
        { label: "choco", probe: "choco", steps: [["choco", ["install", "php", "-y"]]] },
        { label: "scoop", probe: "scoop", steps: [["scoop", ["install", "php"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "php"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "php"]]] },
        { label: "dnf", probe: "dnf", steps: [["dnf", ["install", "-y", "php"]]] },
        { label: "yum", probe: "yum", steps: [["yum", ["install", "-y", "php"]]] },
        { label: "pacman", probe: "pacman", steps: [["pacman", ["-Sy", "--noconfirm", "php"]]] },
        { label: "zypper", probe: "zypper", steps: [["zypper", ["--non-interactive", "install", "php"]]] }
      ]
    },
    ruby: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "RubyInstallerTeam.RubyWithDevKit.3.2", "-e", "--source", "winget"]]] },
        { label: "choco", probe: "choco", steps: [["choco", ["install", "ruby", "-y"]]] },
        { label: "scoop", probe: "scoop", steps: [["scoop", ["install", "ruby"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "ruby"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "ruby-full"]]] },
        { label: "dnf", probe: "dnf", steps: [["dnf", ["install", "-y", "ruby"]]] },
        { label: "yum", probe: "yum", steps: [["yum", ["install", "-y", "ruby"]]] },
        { label: "pacman", probe: "pacman", steps: [["pacman", ["-Sy", "--noconfirm", "ruby"]]] },
        { label: "zypper", probe: "zypper", steps: [["zypper", ["--non-interactive", "install", "ruby"]]] }
      ]
    },
    perl: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "StrawberryPerl.StrawberryPerl", "-e", "--source", "winget"]]] },
        { label: "choco", probe: "choco", steps: [["choco", ["install", "strawberryperl", "-y"]]] },
        { label: "scoop", probe: "scoop", steps: [["scoop", ["install", "perl"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "perl"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "perl"]]] },
        { label: "dnf", probe: "dnf", steps: [["dnf", ["install", "-y", "perl"]]] },
        { label: "yum", probe: "yum", steps: [["yum", ["install", "-y", "perl"]]] },
        { label: "pacman", probe: "pacman", steps: [["pacman", ["-Sy", "--noconfirm", "perl"]]] },
        { label: "zypper", probe: "zypper", steps: [["zypper", ["--non-interactive", "install", "perl"]]] }
      ]
    },
    bun: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "Oven-sh.Bun", "-e", "--source", "winget"]]] },
        { label: "scoop", probe: "scoop", steps: [["scoop", ["install", "bun"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "bun"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "unzip"]]] }
      ]
    },
    deno: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "DenoLand.Deno", "-e", "--source", "winget"]]] },
        { label: "scoop", probe: "scoop", steps: [["scoop", ["install", "deno"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "deno"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "deno"]]] },
        { label: "dnf", probe: "dnf", steps: [["dnf", ["install", "-y", "deno"]]] },
        { label: "zypper", probe: "zypper", steps: [["zypper", ["--non-interactive", "install", "deno"]]] }
      ]
    },
    powershell: {
      windows: [
        { label: "winget", probe: "winget", steps: [["winget", ["install", "--id", "Microsoft.PowerShell", "-e", "--source", "winget"]]] }
      ],
      macos: [{ label: "brew", probe: "brew", steps: [["brew", ["install", "--cask", "powershell"]]] }],
      linux: [
        { label: "apt-get", probe: "apt-get", steps: [["apt-get", ["update"]], ["apt-get", ["install", "-y", "powershell"]]] },
        { label: "dnf", probe: "dnf", steps: [["dnf", ["install", "-y", "powershell"]]] },
        { label: "yum", probe: "yum", steps: [["yum", ["install", "-y", "powershell"]]] }
      ]
    }
  };

  const candidates = map[interpreterKey]?.[platform] || [];
  return candidates;
}

async function getInterpreterInstallerStatus(interpreterKey) {
  const platform = getPlatformName();
  const key = String(interpreterKey || "").trim().toLowerCase();
  const unsupported = new Set(["node", "bash", "sh"]);
  const elevated = await isElevatedRuntime();
  if (unsupported.has(key)) {
    return {
      key,
      platform,
      supported: false,
      canInstall: false,
      requiresElevated: false,
      elevated,
      reason: key === "node"
        ? "Use Node Runtime Manager installer for Node"
        : `${key} is typically built-in on this platform`,
      availableManagers: [],
      commands: []
    };
  }

  const candidates = buildInstallCandidates(key, platform);
  if (!candidates.length) {
    return {
      key,
      platform,
      supported: false,
      canInstall: false,
      requiresElevated: true,
      elevated,
      reason: "No supported installer strategy for this interpreter on current platform",
      availableManagers: [],
      commands: []
    };
  }

  const managerChecks = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      available: await commandExists(candidate.probe)
    }))
  );
  const available = managerChecks.filter((item) => item.available);

  return {
    key,
    platform,
    supported: true,
    canInstall: Boolean(available.length > 0 && elevated),
    requiresElevated: true,
    elevated,
    reason: available.length === 0
      ? "No supported package manager command detected"
      : elevated
        ? null
        : "pm2-dashboard is not running with elevated privileges (root/admin)",
    availableManagers: available.map((item) => item.label),
    commands: available.map((item) => item.steps.map((step) => `${step[0]} ${step[1].join(" ")}`)).flat()
  };
}

async function installInterpreter(interpreterKey) {
  const status = await getInterpreterInstallerStatus(interpreterKey);
  if (!status.supported) {
    throw new Error(status.reason || "Interpreter install is not supported");
  }
  if (!status.elevated) {
    throw new Error("Interpreter install requires elevated runtime permission (root/admin)");
  }

  const candidates = buildInstallCandidates(status.key, status.platform);
  const outcomes = [];
  for (const candidate of candidates) {
    const available = await commandExists(candidate.probe);
    if (!available) {
      outcomes.push({
        manager: candidate.label,
        attempted: false,
        success: false,
        error: "Package manager not available"
      });
      continue;
    }

    try {
      const logs = [];
      for (const [command, args] of candidate.steps) {
        const result = await runCommand(command, args);
        logs.push({
          command: `${command} ${args.join(" ")}`,
          output: String(result.stdout || result.stderr || "").trim().slice(-2000)
        });
      }
      outcomes.push({
        manager: candidate.label,
        attempted: true,
        success: true,
        logs
      });
      return {
        manager: candidate.label,
        outcomes
      };
    } catch (error) {
      outcomes.push({
        manager: candidate.label,
        attempted: true,
        success: false,
        error: error?.message || "Install command failed"
      });
    }
  }

  throw new Error(
    `Failed to install ${status.key}. ${outcomes
      .filter((item) => item.attempted && !item.success)
      .map((item) => `${item.manager}: ${item.error}`)
      .join(" | ") || "No working installer was found"}`
  );
}

module.exports = {
  getInterpreterInstallerStatus,
  installInterpreter
};

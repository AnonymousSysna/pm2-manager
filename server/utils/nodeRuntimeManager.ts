// @ts-nocheck
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;

function normalizeVersion(raw = "") {
  const value = String(raw || "").trim().replace(/^v/i, "");
  return value;
}

function parseVersionParts(version = "") {
  const match = normalizeVersion(version).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [
    Number(match[1] || 0),
    Number(match[2] || 0),
    Number(match[3] || 0)
  ];
}

function compareVersions(a = "", b = "") {
  const pa = parseVersionParts(a) || [0, 0, 0];
  const pb = parseVersionParts(b) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) {
      return 1;
    }
    if (pa[i] < pb[i]) {
      return -1;
    }
  }
  return 0;
}

function versionSatisfiesSpec(version, spec) {
  const normalizedVersion = normalizeVersion(version);
  const normalizedSpec = normalizeVersion(spec);
  if (!normalizedSpec) {
    return Boolean(normalizedVersion);
  }

  const specParts = normalizedSpec.split(".").filter(Boolean);
  const versionParts = normalizedVersion.split(".").filter(Boolean);
  if (specParts.length === 0) {
    return true;
  }
  if (versionParts.length < specParts.length) {
    return false;
  }
  for (let i = 0; i < specParts.length; i += 1) {
    if (specParts[i] !== versionParts[i]) {
      return false;
    }
  }
  return true;
}

function pickBestMatchingVersion(versions = [], spec = "") {
  const candidates = versions
    .map((value) => normalizeVersion(value))
    .filter(Boolean)
    .filter((value) => versionSatisfiesSpec(value, spec))
    .sort((a, b) => compareVersions(b, a));
  return candidates[0] || "";
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
    env
  } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
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
  const probeCommand = process.platform === "win32" ? "where" : "which";
  try {
    await runCommand(probeCommand, [command]);
    return true;
  } catch (_error) {
    return false;
  }
}

function parseFnmVersions(raw = "") {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\*/, "").trim())
    .map((line) => {
      const match = line.match(/v?\d+\.\d+\.\d+/);
      return match ? normalizeVersion(match[0]) : "";
    })
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => compareVersions(b, a));
}

function parseNvmWindowsVersions(raw = "") {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\*/, "").trim())
    .map((line) => {
      const match = line.match(/(\d+\.\d+\.\d+)/);
      return match ? normalizeVersion(match[1]) : "";
    })
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => compareVersions(b, a));
}

async function detectFnmRuntime() {
  const installed = await commandExists("fnm");
  if (!installed) {
    return {
      manager: "fnm",
      displayName: "Fast Node Manager (fnm)",
      installed: false,
      versions: [],
      resolved: null
    };
  }

  let versions = [];
  try {
    const listed = await runCommand("fnm", ["list"]);
    versions = parseFnmVersions(`${listed.stdout}\n${listed.stderr}`);
  } catch (_error) {
    versions = [];
  }

  return {
    manager: "fnm",
    displayName: "Fast Node Manager (fnm)",
    installed: true,
    versions,
    resolved: null
  };
}

function getNvmWindowsHome() {
  const fromEnv = String(process.env.NVM_HOME || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (process.platform !== "win32") {
    return "";
  }
  const appData = String(process.env.APPDATA || "").trim();
  if (!appData) {
    return "";
  }
  return path.join(appData, "nvm");
}

function buildNvmWindowsNodePath(version) {
  const home = getNvmWindowsHome();
  if (!home || !version) {
    return null;
  }
  const withPrefix = path.join(home, `v${normalizeVersion(version)}`, "node.exe");
  const withoutPrefix = path.join(home, normalizeVersion(version), "node.exe");
  if (fs.existsSync(withPrefix)) {
    return withPrefix;
  }
  if (fs.existsSync(withoutPrefix)) {
    return withoutPrefix;
  }
  return null;
}

function buildNvmWindowsNpmPath(version) {
  const nodePath = buildNvmWindowsNodePath(version);
  if (!nodePath) {
    return null;
  }
  const npmPath = path.join(path.dirname(nodePath), "npm.cmd");
  return fs.existsSync(npmPath) ? npmPath : null;
}

async function detectNvmWindowsRuntime() {
  if (process.platform !== "win32") {
    return {
      manager: "nvm-windows",
      displayName: "NVM for Windows",
      installed: false,
      versions: [],
      resolved: null
    };
  }

  const installed = await commandExists("nvm");
  if (!installed) {
    return {
      manager: "nvm-windows",
      displayName: "NVM for Windows",
      installed: false,
      versions: [],
      resolved: null
    };
  }

  let versions = [];
  try {
    const listed = await runCommand("nvm", ["list"]);
    versions = parseNvmWindowsVersions(`${listed.stdout}\n${listed.stderr}`);
  } catch (_error) {
    versions = [];
  }

  return {
    manager: "nvm-windows",
    displayName: "NVM for Windows",
    installed: true,
    versions,
    resolved: null
  };
}

async function detectSystemNodeRuntime() {
  const exists = await commandExists("node");
  if (!exists) {
    return {
      installed: false,
      version: null,
      nodePath: null,
      npmPath: null
    };
  }

  let version = null;
  let nodePath = null;
  try {
    const versionResult = await runCommand("node", ["--version"]);
    const raw = String(versionResult.stdout || versionResult.stderr || "").trim();
    version = normalizeVersion(raw.replace(/^v/i, ""));
  } catch (_error) {
    version = null;
  }

  try {
    const execPathResult = await runCommand("node", ["-p", "process.execPath"]);
    nodePath = String(execPathResult.stdout || "").trim() || null;
  } catch (_error) {
    nodePath = null;
  }

  let npmPath = null;
  if (nodePath) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    const fromNodeDir = path.join(path.dirname(nodePath), npmCmd);
    if (fs.existsSync(fromNodeDir)) {
      npmPath = fromNodeDir;
    }
  }

  return {
    installed: true,
    version,
    nodePath,
    npmPath
  };
}

function getManagerInstallCommands() {
  const platform = getPlatformName();
  if (platform === "windows") {
    return {
      fnm: ["winget install --id Schniz.fnm -e --source winget"],
      "nvm-windows": ["winget install --id CoreyButler.NVMforWindows -e --source winget"]
    };
  }
  if (platform === "macos") {
    return {
      fnm: ["brew install fnm"],
      "nvm-windows": []
    };
  }
  return {
    fnm: ["curl -fsSL https://fnm.vercel.app/install | bash"],
    "nvm-windows": []
  };
}

async function getNodeRuntimeCatalog() {
  const [fnmRuntime, nvmWindowsRuntime, systemNode] = await Promise.all([
    detectFnmRuntime(),
    detectNvmWindowsRuntime(),
    detectSystemNodeRuntime()
  ]);
  const installHints = getManagerInstallCommands();

  const managers = [fnmRuntime, nvmWindowsRuntime]
    .filter((item) => item.manager !== "nvm-windows" || process.platform === "win32")
    .map((item) => ({
      manager: item.manager,
      displayName: item.displayName,
      installed: item.installed,
      versions: item.versions || [],
      installCommands: installHints[item.manager] || []
    }));

  const discoveredVersions = [];
  managers.forEach((item) => {
    (item.versions || []).forEach((version) => {
      discoveredVersions.push({
        version,
        manager: item.manager
      });
    });
  });
  if (systemNode.installed && systemNode.version) {
    discoveredVersions.push({
      version: systemNode.version,
      manager: "system"
    });
  }

  return {
    platform: getPlatformName(),
    managers,
    systemNode,
    versions: discoveredVersions
      .sort((a, b) => compareVersions(b.version, a.version))
      .filter((item, index, list) =>
        list.findIndex(
          (other) => other.version === item.version && other.manager === item.manager
        ) === index
      )
  };
}

async function resolveFnmNode(versionSpec, { installIfMissing = false } = {}) {
  const fnm = await detectFnmRuntime();
  if (!fnm.installed) {
    throw new Error("fnm is not installed");
  }

  let versions = fnm.versions || [];
  let resolvedVersion = pickBestMatchingVersion(versions, versionSpec);

  if (!resolvedVersion && installIfMissing) {
    await runCommand("fnm", ["install", String(versionSpec || "").trim() || "--lts"]);
    const updated = await detectFnmRuntime();
    versions = updated.versions || [];
    resolvedVersion = pickBestMatchingVersion(versions, versionSpec);
  }

  if (!resolvedVersion) {
    throw new Error(`Node version not installed in fnm: ${versionSpec}`);
  }

  const nodePathResult = await runCommand("fnm", [
    "exec",
    "--using",
    resolvedVersion,
    "--",
    "node",
    "-p",
    "process.execPath"
  ]);
  const nodePath = String(nodePathResult.stdout || "").trim();
  if (!nodePath) {
    throw new Error(`Unable to resolve Node binary path for fnm version ${resolvedVersion}`);
  }

  return {
    manager: "fnm",
    version: normalizeVersion(resolvedVersion),
    nodePath,
    npmCommand: "fnm",
    wrapNpmArgs: (args = []) => [
      "exec",
      "--using",
      normalizeVersion(resolvedVersion),
      "--",
      "npm",
      ...args
    ],
    startCommand: {
      script: "fnm",
      args: `exec --using ${normalizeVersion(resolvedVersion)} -- npm run start`
    }
  };
}

async function resolveNvmWindowsNode(versionSpec, { installIfMissing = false } = {}) {
  const nvm = await detectNvmWindowsRuntime();
  if (!nvm.installed) {
    throw new Error("nvm-windows is not installed");
  }

  let versions = nvm.versions || [];
  let resolvedVersion = pickBestMatchingVersion(versions, versionSpec);
  if (!resolvedVersion && installIfMissing) {
    await runCommand("nvm", ["install", String(versionSpec || "").trim() || "lts"]);
    const updated = await detectNvmWindowsRuntime();
    versions = updated.versions || [];
    resolvedVersion = pickBestMatchingVersion(versions, versionSpec);
  }

  if (!resolvedVersion) {
    throw new Error(`Node version not installed in nvm-windows: ${versionSpec}`);
  }

  const nodePath = buildNvmWindowsNodePath(resolvedVersion);
  if (!nodePath) {
    throw new Error(`Unable to resolve node.exe for nvm-windows version ${resolvedVersion}`);
  }
  const npmPath = buildNvmWindowsNpmPath(resolvedVersion);
  if (!npmPath) {
    throw new Error(`Unable to resolve npm.cmd for nvm-windows version ${resolvedVersion}`);
  }

  return {
    manager: "nvm-windows",
    version: normalizeVersion(resolvedVersion),
    nodePath,
    npmCommand: npmPath,
    wrapNpmArgs: (args = []) => args,
    startCommand: {
      script: npmPath,
      args: "run start"
    }
  };
}

async function installNodeRuntimeVersion(versionSpec, preferredManager = "") {
  const manager = String(preferredManager || "").trim().toLowerCase();
  if (manager === "fnm") {
    const resolved = await resolveFnmNode(versionSpec, { installIfMissing: true });
    return {
      manager: resolved.manager,
      version: resolved.version,
      nodePath: resolved.nodePath
    };
  }
  if (manager === "nvm-windows") {
    const resolved = await resolveNvmWindowsNode(versionSpec, { installIfMissing: true });
    return {
      manager: resolved.manager,
      version: resolved.version,
      nodePath: resolved.nodePath
    };
  }

  const fnm = await detectFnmRuntime();
  if (fnm.installed) {
    const resolved = await resolveFnmNode(versionSpec, { installIfMissing: true });
    return {
      manager: resolved.manager,
      version: resolved.version,
      nodePath: resolved.nodePath
    };
  }

  if (process.platform === "win32") {
    const nvm = await detectNvmWindowsRuntime();
    if (nvm.installed) {
      const resolved = await resolveNvmWindowsNode(versionSpec, { installIfMissing: true });
      return {
        manager: resolved.manager,
        version: resolved.version,
        nodePath: resolved.nodePath
      };
    }
  }

  throw new Error("No supported Node version manager is installed. Install fnm first.");
}

async function resolveNodeRuntimeForVersion(versionSpec, { autoInstall = false } = {}) {
  const normalizedSpec = normalizeVersion(versionSpec);
  if (!normalizedSpec) {
    return null;
  }

  const fnm = await detectFnmRuntime();
  if (fnm.installed) {
    return resolveFnmNode(normalizedSpec, { installIfMissing: autoInstall });
  }

  if (process.platform === "win32") {
    const nvm = await detectNvmWindowsRuntime();
    if (nvm.installed) {
      return resolveNvmWindowsNode(normalizedSpec, { installIfMissing: autoInstall });
    }
  }

  throw new Error(
    "No supported Node version manager found for version pinning. Install fnm (recommended) or nvm-windows."
  );
}

async function detectNodeVersionFromProject(projectDir) {
  const base = String(projectDir || "").trim();
  if (!base) {
    return "";
  }

  const nvmrcPath = path.join(base, ".nvmrc");
  try {
    const nvmrc = String(await fs.promises.readFile(nvmrcPath, "utf8")).trim();
    const normalized = normalizeVersion(nvmrc);
    if (normalized) {
      return normalized;
    }
  } catch (_error) {
    // Ignore missing .nvmrc
  }

  const packageJsonPath = path.join(base, "package.json");
  try {
    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, "utf8"));
    const engineNode = String(packageJson?.engines?.node || "").trim();
    if (engineNode) {
      const match = engineNode.match(/\d+(?:\.\d+){0,2}/);
      if (match) {
        return normalizeVersion(match[0]);
      }
    }
  } catch (_error) {
    // Ignore invalid package.json
  }

  return "";
}

module.exports = {
  getNodeRuntimeCatalog,
  installNodeRuntimeVersion,
  resolveNodeRuntimeForVersion,
  detectNodeVersionFromProject,
  normalizeVersion
};

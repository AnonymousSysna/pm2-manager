#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const http = require("http");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_REPO_URL = "https://github.com/AnonymousSysna/pm2-manager.git";
const APP_PACKAGE_NAME = "pm2-dashboard";
const NPM_SAFE_INSTALL_SCRIPT = path.join("scripts", "npm-safe-install.js");
const APP_PROCESS_NAME = "pm2-dashboard";
const DEFAULT_PORT = 8000;
const DEFAULT_PUBLIC_PORT = 8000;
const DEFAULT_INTERNAL_PORT = 8001;
const PLACEHOLDER_VALUES = new Set([
  "replace_with_admin_username",
  "replace_with_long_random_secret",
  "replace_with_long_random_token",
  "replace_with_at_least_32_random_characters",
  "$2a$10$replace_with_bcrypt_hash",
  "/user/pm2-manager/apps/"
]);

const PLACEHOLDER_PATTERNS = [
  /^replace_/i,
  /replace[_-]?with/i,
  /^changeme$/i,
  /^change[-_]?this/i,
  /^your[-_]?secret/i,
  /^dev[-_]?secret/i,
  /^admin$/i
];
const MIN_GENERATED_SECRET_LENGTH = 32;

function parseBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (token.startsWith("--no-")) {
      flags[token.slice(5)] = false;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex > 2) {
        flags[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
        continue;
      }

      const key = token.slice(2);
      const next = argv[index + 1];
      if (next !== undefined && !String(next).startsWith("-")) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    positionals.push(token);
  }

  return { flags, positionals };
}

function normalizePort(rawValue, fallback = DEFAULT_PORT) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const port = Math.floor(numeric);
  if (port < 1 || port > 65535) {
    return fallback;
  }
  return port;
}

function getPublicPort(options) {
  return normalizePort(options?.publicPort ?? options?.port, DEFAULT_PUBLIC_PORT);
}

function getLocalUrl(options) {
  return `http://localhost:${normalizePort(options?.port, DEFAULT_PORT)}`;
}

function getPublicUrl(options) {
  if (options?.domain) {
    const scheme = options?.setupSsl === false ? "http" : "https";
    return `${scheme}://${options.domain}:${getPublicPort(options)}`;
  }
  return getLocalUrl(options);
}

function getCaddySiteAddress(options) {
  if (!options?.domain) {
    return "";
  }
  return `https://${options.domain}:${getPublicPort(options)}`;
}

function getPublicOrigins(options) {
  const origins = [getLocalUrl(options)];
  if (options?.domain) {
    const publicPort = getPublicPort(options);
    origins.push(`http://${options.domain}:${publicPort}`);
    origins.push(`https://${options.domain}:${publicPort}`);
  }
  return origins;
}

function finalizeNetworkOptions(options) {
  const publicPort = getPublicPort(options);
  options.publicPort = publicPort;

  if (options.domain && options.setupSsl !== false) {
    if (!options.appPortExplicit && normalizePort(options.port, DEFAULT_PORT) === publicPort) {
      options.port = publicPort < 65535 ? publicPort + 1 : DEFAULT_INTERNAL_PORT;
    }
    options.siteAddress = getCaddySiteAddress(options);
  } else {
    options.siteAddress = "";
  }

  if (!options.upstreamExplicit) {
    options.upstream = `127.0.0.1:${normalizePort(options.port, DEFAULT_PORT)}`;
  } else if (options.upstream) {
    options.upstream = sanitizeUpstream(options.upstream);
  }

  options.publicUrl = getPublicUrl(options);
  return options;
}

function sanitizeDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (!domain) {
    return "";
  }
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    throw new Error("Domain must not include protocol");
  }
  if (!/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error(`Invalid domain: ${domain}`);
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

function getExplicitFlagOrEnv(flags, env, flagName, envName) {
  const raw = flags[flagName] ?? env[envName];
  return raw === undefined || raw === null || raw === "" ? undefined : raw;
}

function isTruthyFlag(value) {
  return value === true || parseBoolean(value) === true;
}

function isRepoDir(candidatePath) {
  try {
    const packageJsonPath = path.join(candidatePath, "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed?.name === APP_PACKAGE_NAME;
  } catch (_error) {
    return false;
  }
}

function resolveAppDir(explicitAppDir) {
  if (explicitAppDir) {
    const resolved = path.resolve(explicitAppDir);
    if (!isRepoDir(resolved)) {
      throw new Error(`Resolved app directory is not a pm2-manager repo: ${resolved}`);
    }
    return resolved;
  }

  const cwd = process.cwd();
  if (isRepoDir(cwd)) {
    return cwd;
  }

  throw new Error("Run this installer from the pm2-manager repository or pass --app-dir");
}

function getPlatformName(platform = process.platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin") {
    return "macos";
  }
  return "linux";
}

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function hasCommand(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], {
    stdio: "ignore"
  });
  return result.status === 0;
}

function buildCaddyInstallCommands(platform, commandAvailability = {}) {
  if (platform === "windows") {
    const commands = [];
    if (commandAvailability.winget) {
      commands.push("winget install --id CaddyServer.Caddy -e --source winget");
    }
    if (commandAvailability.choco) {
      commands.push("choco install caddy -y");
    }
    if (commandAvailability.scoop) {
      commands.push("scoop install caddy");
    }
    return commands;
  }

  if (platform === "macos") {
    return commandAvailability.brew ? ["brew install caddy"] : [];
  }

  if (commandAvailability["apt-get"]) {
    return ["apt-get update", "apt-get install -y caddy"];
  }
  if (commandAvailability.dnf) {
    return ["dnf install -y caddy"];
  }
  if (commandAvailability.yum) {
    return ["yum install -y caddy"];
  }
  if (commandAvailability.pacman) {
    return ["pacman -Sy --noconfirm caddy"];
  }
  if (commandAvailability.zypper) {
    return ["zypper --non-interactive install caddy"];
  }
  return [];
}

function mergeOrigins(existingValue, extraOrigins) {
  const origins = new Set();
  String(existingValue || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => origins.add(entry));
  for (const origin of extraOrigins || []) {
    const value = String(origin || "").trim();
    if (value) {
      origins.add(value);
    }
  }
  return Array.from(origins).join(",");
}

function parseEnvLine(line) {
  const match = String(line || "").match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    return null;
  }
  return {
    key: match[1],
    value: match[2]
  };
}

function parseEnvContent(content) {
  const values = {};
  String(content || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const entry = parseEnvLine(line);
      if (entry) {
        values[entry.key] = entry.value;
      }
    });
  return values;
}

function upsertEnvContent(content, updates, removals = []) {
  const lines = String(content || "").split(/\r?\n/);
  const removeSet = new Set(removals || []);
  const pending = new Map();
  Object.entries(updates || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      pending.set(key, String(value));
    }
  });

  const nextLines = [];
  for (const line of lines) {
    const entry = parseEnvLine(line);
    if (!entry) {
      nextLines.push(line);
      continue;
    }
    if (removeSet.has(entry.key)) {
      continue;
    }
    if (pending.has(entry.key)) {
      nextLines.push(`${entry.key}=${pending.get(entry.key)}`);
      pending.delete(entry.key);
      continue;
    }
    nextLines.push(line);
  }

  if (pending.size > 0 && nextLines.length > 0 && String(nextLines[nextLines.length - 1]).trim() !== "") {
    nextLines.push("");
  }
  for (const [key, value] of pending.entries()) {
    nextLines.push(`${key}=${value}`);
  }

  return `${nextLines.filter((line, index, array) => !(index === array.length - 1 && line === "")).join("\n")}\n`;
}

function getEnvValue(envValues, key) {
  return String(envValues[key] || "").trim();
}

function looksLikePlaceholder(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return false;
  }
  return PLACEHOLDER_VALUES.has(normalized) || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function needsGeneratedValue(value) {
  const normalized = String(value || "").trim();
  return !normalized || looksLikePlaceholder(normalized);
}

function needsStrongSecretGeneratedValue(value) {
  const normalized = String(value || "").trim();
  return needsGeneratedValue(normalized) || normalized.length < MIN_GENERATED_SECRET_LENGTH;
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function createPasswordHash(appDir, password) {
  const candidates = [
    path.join(appDir, "server", "node_modules", "bcryptjs"),
    "bcryptjs"
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const bcrypt = require(candidate);
      return bcrypt.hashSync(password, 10);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to generate PM2_PASS_HASH. Run npm --prefix server install first. ${lastError?.message || ""}`
  );
}

function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    allowNonZero = false,
    quiet = false
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (quiet) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !allowNonZero) {
        const commandLine = [command, ...args].join(" ");
        reject(new Error(`Command failed (${commandLine}), exit code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

function detectLinuxPrivilege() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0) {
    return {
      privileged: true,
      mode: "root",
      elevationCommand: null
    };
  }

  if (hasCommand("sudo")) {
    const result = spawnSync("sudo", ["-n", "true"], {
      stdio: "ignore"
    });
    if (result.status === 0) {
      return {
        privileged: true,
        mode: "sudo",
        elevationCommand: "sudo"
      };
    }
  }

  if (hasCommand("doas")) {
    const result = spawnSync("doas", ["-n", "true"], {
      stdio: "ignore"
    });
    if (result.status === 0) {
      return {
        privileged: true,
        mode: "doas",
        elevationCommand: "doas"
      };
    }
  }

  return {
    privileged: false,
    mode: "user",
    elevationCommand: hasCommand("sudo") ? "sudo" : hasCommand("doas") ? "doas" : null
  };
}

function detectWindowsPrivilege() {
  const script = [
    "[Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()",
    ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
  ].join("");
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const isElevated = result.status === 0 && /true/i.test(String(result.stdout || ""));
  return {
    privileged: isElevated,
    mode: isElevated ? "administrator" : "user",
    elevationCommand: null
  };
}

function detectPrivilegeContext() {
  const platform = getPlatformName();
  if (platform === "windows") {
    return detectWindowsPrivilege();
  }
  return detectLinuxPrivilege();
}

function buildAdminNextSteps({
  platform,
  appDir,
  domain,
  port,
  publicPort,
  caddyInstallCommands,
  preferElevated
}) {
  const quotedInstaller = `"${path.join(appDir, "scripts", "onetap.js")}"`;
  const commandPrefix = `node ${quotedInstaller}`;
  const domainFlag = domain ? ` --domain ${domain}` : "";
  const effectivePublicPort = publicPort || port;
  const publicPortFlag = effectivePublicPort ? ` --public-port ${effectivePublicPort}` : "";
  const sslCommand = `${commandPrefix} --setup-ssl --install-caddy${domainFlag}${publicPortFlag} --app-port ${port}`;
  const steps = [];

  if (platform === "windows") {
    steps.push("Re-run the installer from an elevated Administrator PowerShell session to enable SSL.");
    steps.push(`Admin command: ${sslCommand}`);
  } else if (preferElevated) {
    steps.push(`Re-run the installer with elevated privileges (${preferElevated}) to enable SSL.`);
    steps.push(`Admin command: ${preferElevated} ${sslCommand}`);
  } else {
    steps.push("Re-run the installer as root or a sudo-capable user to enable SSL.");
    steps.push(`Admin command: ${sslCommand}`);
  }

  if (caddyInstallCommands.length > 0) {
    steps.push(`Expected Caddy install path: ${caddyInstallCommands.join("  then  ")}`);
  } else {
    steps.push("No supported Caddy install command was detected automatically on this system.");
  }

  steps.push(`Before enabling SSL, make sure the chosen domain resolves to this server and public port ${effectivePublicPort} is reachable.`);
  return steps;
}

async function prompt(question, defaultValue = "") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(question, resolve);
    });
    const trimmed = String(answer || "").trim();
    return trimmed || defaultValue;
  } finally {
    rl.close();
  }
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function buildOptions({ argv, env, appDir }) {
  const parsed = parseArgs(argv);
  const flags = parsed.flags;
  const defaultInstallDir = parsed.positionals[0] || env.PM2_MANAGER_DIR || path.join(os.homedir(), "pm2-manager");
  const appPortRaw = getExplicitFlagOrEnv(flags, env, "app-port", "PM2_MANAGER_APP_PORT");
  const legacyPortRaw = getExplicitFlagOrEnv(flags, env, "port", "PORT");
  const publicPortRaw = getExplicitFlagOrEnv(flags, env, "public-port", "PM2_MANAGER_PUBLIC_PORT")
    ?? getExplicitFlagOrEnv(flags, env, "port", "PM2_MANAGER_PORT");
  const port = normalizePort(appPortRaw ?? legacyPortRaw, DEFAULT_PORT);
  const publicPort = normalizePort(publicPortRaw ?? DEFAULT_PUBLIC_PORT, DEFAULT_PUBLIC_PORT);
  const domain = sanitizeDomain(flags.domain ?? env.PM2_MANAGER_DOMAIN ?? "");
  const setupSsl = parseBoolean(flags["setup-ssl"] ?? env.PM2_MANAGER_SETUP_SSL);
  const installCaddy = parseBoolean(flags["install-caddy"] ?? env.PM2_MANAGER_INSTALL_CADDY);
  const upstreamRaw = getExplicitFlagOrEnv(flags, env, "upstream", "PM2_MANAGER_UPSTREAM");

  const options = {
    appDir,
    targetDir: path.resolve(String(flags["target-dir"] || env.PM2_MANAGER_DIR || defaultInstallDir)),
    repoUrl: String(flags["repo-url"] || env.REPO_URL || DEFAULT_REPO_URL),
    port,
    publicPort,
    domain,
    upstream: upstreamRaw ? String(upstreamRaw) : "",
    upstreamExplicit: upstreamRaw !== undefined,
    appPortExplicit: appPortRaw !== undefined || legacyPortRaw !== undefined,
    setupSsl: setupSsl === undefined && domain ? true : setupSsl,
    installCaddy: installCaddy === undefined && domain ? true : installCaddy,
    nonInteractive: isTruthyFlag(flags["non-interactive"]) || parseBoolean(env.CI) === true,
    caddyfilePath: String(env.CADDYFILE_PATH || "").trim()
  };

  return finalizeNetworkOptions(options);
}

async function maybePromptForSsl(options, privilegeContext) {
  if (options.nonInteractive || !isInteractive()) {
    return finalizeNetworkOptions(options);
  }

  if (options.setupSsl === undefined && !options.domain) {
    const domain = await prompt(
      "Domain for PM2 Manager public port? Example pm2.example.com. Leave blank for local HTTP only: ",
      ""
    );
    options.domain = sanitizeDomain(domain);
    options.setupSsl = Boolean(options.domain);
  }

  if (options.setupSsl === true && !options.domain) {
    const domain = await prompt("Domain for PM2 Manager HTTPS public port (leave blank to skip SSL setup): ", "");
    options.domain = sanitizeDomain(domain);
    if (!options.domain) {
      options.setupSsl = false;
    }
  }

  if (options.setupSsl === true && options.installCaddy === undefined) {
    options.installCaddy = true;
  }

  if (options.setupSsl === true && !privilegeContext.privileged) {
    console.log("SSL was requested. The installer will finish the app install and print the elevated command needed for Caddy/HTTPS on the public port.");
  }

  return finalizeNetworkOptions(options);
}

function summarizeInstallContext(privilegeContext, caddyStatus) {
  const platform = getPlatformName();
  const availableCommands = {
    winget: hasCommand("winget"),
    choco: hasCommand("choco"),
    scoop: hasCommand("scoop"),
    brew: hasCommand("brew"),
    "apt-get": hasCommand("apt-get"),
    dnf: hasCommand("dnf"),
    yum: hasCommand("yum"),
    pacman: hasCommand("pacman"),
    zypper: hasCommand("zypper")
  };

  return {
    platform,
    privilegeContext,
    caddyInstallCommands: caddyStatus?.data?.installCommands?.length
      ? caddyStatus.data.installCommands
      : buildCaddyInstallCommands(platform, availableCommands)
  };
}

function ensureDirExists(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function prepareEnvFile(appDir, options) {
  const envPath = path.join(appDir, ".env");
  const envExamplePath = path.join(appDir, ".env.example");
  let content = "";

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf8");
  } else if (fs.existsSync(envExamplePath)) {
    content = fs.readFileSync(envExamplePath, "utf8");
  }

  const currentValues = parseEnvContent(content);
  const generatedCredentials = {};
  const updates = {};
  const removals = [];

  if (needsGeneratedValue(getEnvValue(currentValues, "PM2_USER"))) {
    generatedCredentials.PM2_USER = `admin_${randomHex(3)}`;
    updates.PM2_USER = generatedCredentials.PM2_USER;
  }

  const hasUsableHash = !needsGeneratedValue(getEnvValue(currentValues, "PM2_PASS_HASH"));
  const existingPlainPass = getEnvValue(currentValues, "PM2_PASS");
  const hasUsablePass = !needsGeneratedValue(existingPlainPass);
  if (!hasUsableHash) {
    const plainPassword = hasUsablePass ? existingPlainPass : randomBase64Url(12);
    if (!hasUsablePass) {
      generatedCredentials.PM2_PASS = plainPassword;
    }
    updates.PM2_PASS_HASH = createPasswordHash(appDir, plainPassword);
    removals.push("PM2_PASS");
  }

  if (needsStrongSecretGeneratedValue(getEnvValue(currentValues, "JWT_SECRET"))) {
    updates.JWT_SECRET = randomHex(32);
    generatedCredentials.JWT_SECRET = "generated";
  }

  if (needsStrongSecretGeneratedValue(getEnvValue(currentValues, "METRICS_TOKEN"))) {
    updates.METRICS_TOKEN = randomHex(32);
    generatedCredentials.METRICS_TOKEN = "generated";
  }

  updates.PORT = String(options.port);
  updates.PM2_MANAGER_PUBLIC_PORT = String(options.publicPort);
  updates.APP_PUBLIC_URL = getPublicUrl(options);
  if (options.domain) {
    updates.PM2_MANAGER_DOMAIN = options.domain;
  }

  const currentProjectsRoot = getEnvValue(currentValues, "PROJECTS_ROOT");
  if (needsGeneratedValue(currentProjectsRoot) || currentProjectsRoot === "/user/pm2-manager/apps/") {
    updates.PROJECTS_ROOT = path.join(appDir, "apps");
  }

  const currentOrigins = getEnvValue(currentValues, "CORS_ALLOWED_ORIGINS");
  updates.CORS_ALLOWED_ORIGINS = mergeOrigins(currentOrigins || `http://localhost:${options.port}`, getPublicOrigins(options));

  const nextContent = upsertEnvContent(content, updates, removals);
  fs.writeFileSync(envPath, nextContent, "utf8");

  return {
    envPath,
    generatedCredentials,
    updates
  };
}

function applyProxyEnvOverrides(appDir, options) {
  const envPath = path.join(appDir, ".env");
  const currentContent = fs.readFileSync(envPath, "utf8");
  const currentValues = parseEnvContent(currentContent);
  const nextContent = upsertEnvContent(currentContent, {
    TRUST_PROXY: "1",
    COOKIE_SECURE: "1",
    APP_PUBLIC_URL: getPublicUrl(options),
    PM2_MANAGER_DOMAIN: options.domain,
    PM2_MANAGER_PUBLIC_PORT: String(options.publicPort),
    CORS_ALLOWED_ORIGINS: mergeOrigins(currentValues.CORS_ALLOWED_ORIGINS, getPublicOrigins(options))
  });

  if (nextContent === currentContent) {
    return false;
  }

  fs.writeFileSync(envPath, nextContent, "utf8");
  return true;
}

async function installDependencies(appDir) {
  console.log("[1/6] Preparing dependency install...");
  console.log("Root npm install is skipped for one-tap production setup to avoid npm workspace tree corruption.");
  console.log("Use `npm run setup:dev` later if you need root dev-only tools.");

  console.log("[2/6] Installing backend dependencies, including local PM2...");
  await runCommand(process.execPath, [path.join(appDir, NPM_SAFE_INSTALL_SCRIPT), "server"], { cwd: appDir });

  console.log("[3/6] Installing frontend dependencies...");
  await runCommand(process.execPath, [path.join(appDir, NPM_SAFE_INSTALL_SCRIPT), "client"], { cwd: appDir });
}

async function buildClient(appDir) {
  const npmCommand = getNpmCommand();
  console.log("[4/6] Building dashboard UI...");
  await runCommand(npmCommand, ["run", "build"], { cwd: appDir });
}

async function ensureBaseInstall(appDir) {
  await installDependencies(appDir);
  await buildClient(appDir);
}

async function runPm2Local(appDir, args, options = {}) {
  return runCommand(process.execPath, [path.join(appDir, "scripts", "pm2-local.js"), ...args], {
    cwd: appDir,
    ...options
  });
}

async function ensurePm2Process(appDir) {
  const probe = await runPm2Local(appDir, ["describe"], {
    allowNonZero: true,
    quiet: true
  });

  if (probe.code === 0) {
    console.log("[5/6] Restarting existing PM2 dashboard process...");
    await runPm2Local(appDir, ["restart"]);
    return "restarted";
  }

  console.log("[5/6] Starting PM2 dashboard process...");
  await runPm2Local(appDir, ["start"]);
  return "started";
}

function requestHttpReady(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/ready",
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 500);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForBackendReady(appDir, port) {
  console.log("[6/6] Waiting for backend readiness...");
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (await requestHttpReady(port)) {
      console.log("Backend readiness check passed.");
      return true;
    }
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Still waiting for http://127.0.0.1:${port}/ready ...`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("Backend readiness check failed. Recent PM2 logs:");
  await runPm2Local(appDir, ["logs", "--lines", "120", "--nostream"], {
    allowNonZero: true
  });
  throw new Error(`Backend did not become ready on http://127.0.0.1:${port}/ready`);
}

async function savePm2ProcessList(appDir) {
  const result = await runPm2Local(appDir, ["save"], {
    allowNonZero: true,
    quiet: true
  });
  if (result.code !== 0) {
    console.log("PM2 save skipped or failed; the dashboard is still running, but startup persistence may need manual setup.");
  }
}

function waitForSocket(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function validateDomainReadiness(domain, publicPort = 443) {
  if (!domain || domain.startsWith("*.")) {
    return {
      dnsResolved: false,
      dnsError: domain ? "Wildcard domain cannot be probed directly" : "No domain configured",
      publicPortReachable: false,
      port80Reachable: false,
      port443Reachable: false
    };
  }

  let dnsResolved = false;
  let dnsError = null;
  try {
    await dns.lookup(domain);
    dnsResolved = true;
  } catch (error) {
    dnsError = error?.message || "DNS lookup failed";
  }

  const publicPortReachable = await waitForSocket(domain, publicPort, 3000);

  return {
    dnsResolved,
    dnsError,
    publicPortReachable,
    port80Reachable: publicPort === 80 ? publicPortReachable : false,
    port443Reachable: publicPort === 443 ? publicPortReachable : false
  };
}

async function maybeConfigureSsl(appDir, options, installContext) {
  const { getCaddyStatus, installCaddy, addReverseProxy, restartCaddyService } = require("../server/utils/caddyManager");
  const statusBefore = await getCaddyStatus();
  const result = {
    attempted: false,
    enabled: false,
    httpOnly: true,
    proxyConfigured: false,
    warnings: [],
    nextSteps: [],
    caddyStatus: statusBefore,
    probe: {
      dnsResolved: false,
      dnsError: null,
      publicPortReachable: false,
      port80Reachable: false,
      port443Reachable: false
    }
  };

  if (options.setupSsl !== true) {
    result.nextSteps.push("SSL setup was skipped. pm2-manager remains available on local/internal HTTP.");
    return result;
  }

  if (!options.domain) {
    result.warnings.push("SSL setup was requested without a domain, so it was skipped.");
    result.nextSteps.push("Re-run with --setup-ssl --domain <fqdn> when you are ready.");
    return result;
  }

  result.attempted = true;

  const dnsProbe = await validateDomainReadiness(options.domain, options.publicPort);
  result.probe = dnsProbe;
  if (!dnsProbe.dnsResolved) {
    result.warnings.push(`DNS is not ready for ${options.domain}: ${dnsProbe.dnsError || "lookup failed"}`);
    result.nextSteps.push(`Point ${options.domain} to this server first, then re-run the installer with --domain ${options.domain}.`);
    result.nextSteps.push("The dashboard still works through the local/internal HTTP URL until the domain is ready.");
    return result;
  }

  if (!installContext.privilegeContext.privileged) {
    result.warnings.push("Current user does not have the privileges required for system-level SSL setup.");
    result.nextSteps.push(
      ...buildAdminNextSteps({
        platform: installContext.platform,
        appDir,
        domain: options.domain,
        port: options.port,
        publicPort: options.publicPort,
        caddyInstallCommands: installContext.caddyInstallCommands,
        preferElevated: installContext.privilegeContext.elevationCommand
      })
    );
    return result;
  }

  const shouldInstallCaddy = options.installCaddy !== false;
  if (shouldInstallCaddy && !statusBefore?.data?.installed) {
    const installResult = await installCaddy();
    if (!installResult.success) {
      result.warnings.push(installResult.error || "Caddy install failed");
      result.nextSteps.push("pm2-manager was installed, but SSL setup stopped before proxy configuration.");
      return result;
    }
  }

  const proxyResult = await addReverseProxy({
    domain: options.domain,
    siteAddress: getCaddySiteAddress(options),
    upstream: options.upstream
  });

  if (!proxyResult.success) {
    result.warnings.push(proxyResult.error || "Reverse proxy configuration failed");
    if (proxyResult?.data?.warnings?.length) {
      result.warnings.push(...proxyResult.data.warnings);
    }
    const restartResult = await restartCaddyService();
    if (!restartResult.success && restartResult.error) {
      result.warnings.push(restartResult.error);
    }
    result.nextSteps.push("Fix the Caddy service/config issue, then re-run the installer with --setup-ssl.");
    return result;
  }

  const restartResult = await restartCaddyService();
  if (!restartResult.success && restartResult.error) {
    result.warnings.push(restartResult.error);
  }

  const probe = await validateDomainReadiness(options.domain, options.publicPort);
  result.probe = probe;

  const statusAfter = await getCaddyStatus();
  result.caddyStatus = statusAfter;
  result.proxyConfigured = true;
  const siteAddress = getCaddySiteAddress(options);
  const managedSite = statusAfter?.data?.managedSites?.find((entry) => entry.siteAddress === siteAddress || entry.domain === siteAddress);
  const httpsState = managedSite?.https?.state || "unknown";

  result.httpOnly = false;
  result.enabled = httpsState === "active";

  if (httpsState !== "active") {
    const explanation = managedSite?.https?.message || "TLS is not active yet";
    result.warnings.push(`HTTPS is not confirmed yet: ${explanation}`);
    if (!probe.dnsResolved && probe.dnsError) {
      result.warnings.push(`DNS probe failed: ${probe.dnsError}`);
    }
    if (!probe.publicPortReachable) {
      result.warnings.push(`Public port ${options.publicPort} was not reachable during the installer probe.`);
    }
    result.nextSteps.push(`The root domain stays untouched. Open firewall port ${options.publicPort} and use ${getPublicUrl(options)} when TLS is ready.`);
  }

  return result;
}

function printSummary({
  appDir,
  envResult,
  options,
  installContext,
  sslResult,
  pm2Action
}) {
  console.log("");
  console.log("Install summary");
  console.log(`- Repo directory: ${appDir}`);
  console.log(`- Platform: ${installContext.platform}`);
  console.log(`- Privileges: ${installContext.privilegeContext.mode}`);
  console.log(`- PM2 app: ${APP_PROCESS_NAME} (${pm2Action})`);
  console.log(`- Local health: http://localhost:${options.port}/ready`);
  console.log(`- Local HTTP: http://localhost:${options.port}`);
  console.log(`- Public URL: ${getPublicUrl(options)}`);

  if (options.domain && (sslResult.proxyConfigured || options.setupSsl === true)) {
    console.log(`- Domain target: ${getCaddySiteAddress(options) || getPublicUrl(options)}`);
    console.log("- Root domain: unchanged");
  }

  if (sslResult.attempted && sslResult.enabled) {
    console.log("- HTTPS: active");
  } else if (sslResult.proxyConfigured) {
    console.log("- HTTPS: pending/manual verification");
  } else {
    console.log("- HTTPS: not configured");
  }

  const generatedUser = envResult.generatedCredentials.PM2_USER;
  const generatedPass = envResult.generatedCredentials.PM2_PASS;
  if (generatedUser || generatedPass) {
    console.log("");
    console.log("Generated login credentials");
    if (generatedUser) {
      console.log(`- Username: ${generatedUser}`);
    }
    if (generatedPass) {
      console.log(`- Password: ${generatedPass}`);
    }
  }

  if (envResult.generatedCredentials.JWT_SECRET || envResult.generatedCredentials.METRICS_TOKEN) {
    console.log("");
    console.log("Generated internal secrets");
    if (envResult.generatedCredentials.JWT_SECRET) {
      console.log("- JWT_SECRET: generated and stored in .env");
    }
    if (envResult.generatedCredentials.METRICS_TOKEN) {
      console.log("- METRICS_TOKEN: generated and stored in .env");
    }
    console.log("- These internal secrets are intentionally not printed.");
  }

  if (sslResult.warnings.length > 0) {
    console.log("");
    console.log("Warnings");
    sslResult.warnings.forEach((warning) => {
      console.log(`- ${warning}`);
    });
  }

  if (sslResult.nextSteps.length > 0) {
    console.log("");
    console.log("Next steps");
    sslResult.nextSteps.forEach((step) => {
      console.log(`- ${step}`);
    });
  }

  console.log("");
  console.log("Useful commands");
  console.log("- Status: npm run pm2:status");
  console.log(`- Logs: npm run pm2:logs -- --lines 120`);
  console.log("- Restart: npm run pm2:restart");
  console.log(`- Health: curl -i http://localhost:${options.port}/ready`);
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const appDir = resolveAppDir(parsedArgs.flags["app-dir"]);
  process.chdir(appDir);

  const statusProbe = (() => {
    try {
      const { getCaddyStatus } = require("../server/utils/caddyManager");
      return getCaddyStatus();
    } catch (_error) {
      return Promise.resolve({ success: false, data: null, error: "Unable to inspect Caddy status" });
    }
  })();
  
  let options = buildOptions({
    argv: process.argv.slice(2),
    env: process.env,
    appDir
  });

  const privilegeContext = detectPrivilegeContext();
  const initialCaddyStatus = await statusProbe;
  const installContext = summarizeInstallContext(privilegeContext, initialCaddyStatus);

  options = await maybePromptForSsl(options, privilegeContext);

  ensureDirExists(path.join(appDir, "logs"));
  await installDependencies(appDir);
  const envResult = prepareEnvFile(appDir, options);

  await buildClient(appDir);
  const pm2Action = await ensurePm2Process(appDir);
  await waitForBackendReady(appDir, options.port);
  await savePm2ProcessList(appDir);
  const sslResult = await maybeConfigureSsl(appDir, options, installContext);
  if (sslResult.proxyConfigured && applyProxyEnvOverrides(appDir, options)) {
    await runCommand(getNpmCommand(), ["run", "pm2:restart"], { cwd: appDir });
  }

  printSummary({
    appDir,
    envResult,
    options,
    installContext,
    sslResult,
    pm2Action
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("");
    console.error("Install failed");
    console.error(error?.message || error);
    console.error("");
    console.error("Recovery commands");
    console.error("- Check PM2: npm run pm2:status");
    console.error("- Read logs: npm run pm2:logs -- --lines 120");
    console.error("- Restart after fixing env: npm run pm2:restart");
    process.exitCode = 1;
  });
}

module.exports = {
  parseBoolean,
  parseArgs,
  normalizePort,
  getPublicPort,
  getCaddySiteAddress,
  finalizeNetworkOptions,
  sanitizeDomain,
  sanitizeUpstream,
  buildCaddyInstallCommands,
  getPublicUrl,
  getPublicOrigins,
  mergeOrigins,
  upsertEnvContent,
  looksLikePlaceholder,
  needsGeneratedValue,
  needsStrongSecretGeneratedValue,
  createPasswordHash,
  installDependencies,
  buildClient,
  ensureBaseInstall,
  requestHttpReady,
  waitForBackendReady,
  buildAdminNextSteps
};

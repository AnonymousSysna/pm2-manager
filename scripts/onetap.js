#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_REPO_URL = "https://github.com/AnonymousSysna/pm2-manager.git";
const APP_PACKAGE_NAME = "pm2-dashboard";
const APP_PROCESS_NAME = "pm2-dashboard";
const DEFAULT_PORT = 8000;
const PLACEHOLDER_VALUES = new Set([
  "replace_with_admin_username",
  "replace_with_long_random_secret",
  "replace_with_long_random_token",
  "$2a$10$replace_with_bcrypt_hash",
  "/user/pm2-manager/apps/"
]);

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

function needsGeneratedValue(value) {
  const normalized = String(value || "").trim();
  return !normalized || PLACEHOLDER_VALUES.has(normalized);
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
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
  caddyInstallCommands,
  preferElevated
}) {
  const quotedInstaller = `"${path.join(appDir, "scripts", "onetap.js")}"`;
  const commandPrefix = `node ${quotedInstaller}`;
  const domainFlag = domain ? ` --domain ${domain}` : "";
  const sslCommand = `${commandPrefix} --setup-ssl --install-caddy${domainFlag} --port ${port}`;
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

  steps.push("Before enabling SSL, make sure the chosen domain resolves to this server and ports 80/443 are reachable.");
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
  const port = normalizePort(flags.port ?? env.PM2_MANAGER_PORT ?? env.PORT, DEFAULT_PORT);

  const options = {
    appDir,
    targetDir: path.resolve(String(flags["target-dir"] || env.PM2_MANAGER_DIR || defaultInstallDir)),
    repoUrl: String(flags["repo-url"] || env.REPO_URL || DEFAULT_REPO_URL),
    port,
    domain: sanitizeDomain(flags.domain ?? env.PM2_MANAGER_DOMAIN ?? ""),
    upstream: String(flags.upstream || env.PM2_MANAGER_UPSTREAM || `127.0.0.1:${port}`),
    setupSsl: parseBoolean(flags["setup-ssl"] ?? env.PM2_MANAGER_SETUP_SSL),
    installCaddy: parseBoolean(flags["install-caddy"] ?? env.PM2_MANAGER_INSTALL_CADDY),
    nonInteractive: isTruthyFlag(flags["non-interactive"]) || parseBoolean(env.CI) === true,
    caddyfilePath: String(env.CADDYFILE_PATH || "").trim()
  };

  if (options.upstream) {
    options.upstream = sanitizeUpstream(options.upstream);
  }

  return options;
}

async function maybePromptForSsl(options, privilegeContext) {
  if (options.nonInteractive || !isInteractive()) {
    return options;
  }

  if (options.setupSsl === undefined && privilegeContext.privileged) {
    const answer = await prompt("Configure optional Caddy reverse proxy + SSL now? [y/N] ", "n");
    options.setupSsl = parseBoolean(answer) === true;
  }

  if (options.setupSsl === true && !options.domain) {
    const domain = await prompt("Domain for pm2-manager HTTPS (leave blank to skip SSL setup): ", "");
    options.domain = sanitizeDomain(domain);
    if (!options.domain) {
      options.setupSsl = false;
    }
  }

  if (options.setupSsl === true && options.installCaddy === undefined) {
    const answer = await prompt("Install Caddy automatically if it is missing? [Y/n] ", "y");
    options.installCaddy = parseBoolean(answer) !== false;
  }

  return options;
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
  const hasUsablePass = !needsGeneratedValue(getEnvValue(currentValues, "PM2_PASS"));
  if (!hasUsableHash && !hasUsablePass) {
    generatedCredentials.PM2_PASS = randomBase64Url(12);
    updates.PM2_PASS = generatedCredentials.PM2_PASS;
    removals.push("PM2_PASS_HASH");
  }

  if (needsGeneratedValue(getEnvValue(currentValues, "JWT_SECRET"))) {
    updates.JWT_SECRET = randomHex(32);
  }

  if (needsGeneratedValue(getEnvValue(currentValues, "METRICS_TOKEN"))) {
    updates.METRICS_TOKEN = randomHex(32);
  }

  updates.PORT = String(options.port);

  const currentProjectsRoot = getEnvValue(currentValues, "PROJECTS_ROOT");
  if (needsGeneratedValue(currentProjectsRoot) || currentProjectsRoot === "/user/pm2-manager/apps/") {
    updates.PROJECTS_ROOT = path.join(appDir, "apps");
  }

  const currentOrigins = getEnvValue(currentValues, "CORS_ALLOWED_ORIGINS");
  updates.CORS_ALLOWED_ORIGINS = mergeOrigins(currentOrigins || `http://localhost:${options.port}`, [
    `http://localhost:${options.port}`
  ]);

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
    CORS_ALLOWED_ORIGINS: mergeOrigins(currentValues.CORS_ALLOWED_ORIGINS, [
      `http://localhost:${options.port}`,
      `http://${options.domain}`,
      `https://${options.domain}`
    ])
  });

  if (nextContent === currentContent) {
    return false;
  }

  fs.writeFileSync(envPath, nextContent, "utf8");
  return true;
}

async function ensureBaseInstall(appDir) {
  const npmCommand = getNpmCommand();
  console.log("Installing dependencies...");
  await runCommand(npmCommand, ["install"], { cwd: appDir });
  await runCommand(npmCommand, ["--prefix", "server", "install"], { cwd: appDir });
  await runCommand(npmCommand, ["--prefix", "client", "install"], { cwd: appDir });

  console.log("Building client...");
  await runCommand(npmCommand, ["run", "build"], { cwd: appDir });
}

async function ensurePm2Process(appDir) {
  const npmCommand = getNpmCommand();
  const probe = await runCommand(npmCommand, ["--prefix", "server", "exec", "pm2", "--", "describe", APP_PROCESS_NAME], {
    cwd: appDir,
    allowNonZero: true,
    quiet: true
  });

  if (probe.code === 0) {
    console.log(`Restarting existing ${APP_PROCESS_NAME}...`);
    await runCommand(npmCommand, ["run", "pm2:restart"], { cwd: appDir });
    return "restarted";
  }

  console.log(`Starting ${APP_PROCESS_NAME}...`);
  await runCommand(npmCommand, ["run", "pm2:start"], { cwd: appDir });
  return "started";
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

async function validateDomainReadiness(domain) {
  if (!domain || domain.startsWith("*.")) {
    return {
      dnsResolved: false,
      dnsError: domain ? "Wildcard domain cannot be probed directly" : "No domain configured",
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

  const [port80Reachable, port443Reachable] = await Promise.all([
    waitForSocket(domain, 80, 3000),
    waitForSocket(domain, 443, 3000)
  ]);

  return {
    dnsResolved,
    dnsError,
    port80Reachable,
    port443Reachable
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

  if (!installContext.privilegeContext.privileged) {
    result.warnings.push("Current user does not have the privileges required for system-level SSL setup.");
    result.nextSteps.push(
      ...buildAdminNextSteps({
        platform: installContext.platform,
        appDir,
        domain: options.domain,
        port: options.port,
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

  const probe = await validateDomainReadiness(options.domain);
  result.probe = probe;

  const statusAfter = await getCaddyStatus();
  result.caddyStatus = statusAfter;
  result.proxyConfigured = true;
  const managedSite = statusAfter?.data?.managedSites?.find((entry) => entry.domain === options.domain);
  const httpsState = managedSite?.https?.state || "unknown";

  result.httpOnly = false;
  result.enabled = httpsState === "active";

  if (httpsState !== "active") {
    const explanation = managedSite?.https?.message || "TLS is not active yet";
    result.warnings.push(`HTTPS is not confirmed yet: ${explanation}`);
    if (!probe.dnsResolved && probe.dnsError) {
      result.warnings.push(`DNS probe failed: ${probe.dnsError}`);
    }
    if (!probe.port80Reachable) {
      result.warnings.push("Port 80 was not reachable during the installer probe.");
    }
    if (!probe.port443Reachable) {
      result.warnings.push("Port 443 was not reachable during the installer probe.");
    }
    result.nextSteps.push("HTTP on the local pm2-manager port remains valid until DNS/public reachability/ports 80 and 443 are fixed.");
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
  console.log(`- Local HTTP: http://localhost:${options.port}`);

  if (options.domain && (sslResult.proxyConfigured || options.setupSsl === true)) {
    const scheme = sslResult.enabled ? "https" : "http";
    console.log(`- Domain target: ${scheme}://${options.domain}`);
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
  console.log(`PM2 logs: npm --prefix server exec pm2 -- logs ${APP_PROCESS_NAME}`);
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
  const envResult = prepareEnvFile(appDir, options);

  await ensureBaseInstall(appDir);
  const pm2Action = await ensurePm2Process(appDir);
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
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  parseBoolean,
  parseArgs,
  normalizePort,
  sanitizeDomain,
  sanitizeUpstream,
  buildCaddyInstallCommands,
  mergeOrigins,
  upsertEnvContent,
  buildAdminNextSteps
};

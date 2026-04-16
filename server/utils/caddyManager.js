const fs = require("fs");
const os = require("os");
const path = require("path");
const tls = require("tls");
const { spawn } = require("child_process");
const { withPermissionHint } = require("./permissionHints");

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
        const baseMessage = `Command failed (${command} ${args.join(" ")}), exit code ${code}${
          stderr ? `: ${stderr.trim()}` : ""
        }`;
        reject(new Error(withPermissionHint(baseMessage, { command, args })));
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

async function readOptionalFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.promises.readFile(filePath, "utf8")
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        exists: false,
        content: ""
      };
    }
    throw error;
  }
}

async function writeTextFile(filePath, content) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf8");
}

async function restoreOptionalFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await writeTextFile(filePath, snapshot.content);
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
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

function isDomainLike(value) {
  return /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(value || "").trim());
}

function extractSiteAddresses(header) {
  return String(header || "")
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/^https?:\/\//i, ""))
    .map((token) => token.replace(/:\d+$/, ""))
    .filter((token) => isDomainLike(token));
}

function parseTopLevelSiteBlocks(content) {
  const lines = String(content || "").split(/\r?\n/);
  const blocks = [];
  let depth = 0;
  let blockStart = -1;
  let blockHeader = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (depth === 0 && blockStart === -1 && trimmed && !trimmed.startsWith("#")) {
      const openIndex = line.indexOf("{");
      if (openIndex >= 0) {
        const header = line.slice(0, openIndex).trim();
        if (header && !header.startsWith("(")) {
          blockStart = index;
          blockHeader = header;
        }
      }
    }

    const openCount = (line.match(/{/g) || []).length;
    const closeCount = (line.match(/}/g) || []).length;
    depth += openCount - closeCount;

    if (blockStart >= 0 && depth === 0) {
      const blockLines = lines.slice(blockStart, index + 1);
      const upstreamLine = blockLines.find((entry) => /^\s*reverse_proxy\s+/.test(entry));
      const upstreamMatch = upstreamLine ? upstreamLine.match(/^\s*reverse_proxy\s+([^\s#]+)/) : null;
      blocks.push({
        start: blockStart,
        end: index,
        addresses: extractSiteAddresses(blockHeader),
        upstream: upstreamMatch ? String(upstreamMatch[1] || "").trim() : "",
        lines: blockLines
      });
      blockStart = -1;
      blockHeader = "";
    }
  }

  return {
    lines,
    blocks
  };
}

async function readCaddyfileSites(caddyfilePath) {
  let content = "";
  try {
    content = await fs.promises.readFile(caddyfilePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    return {};
  }

  const parsed = parseTopLevelSiteBlocks(content);
  const sites = {};
  parsed.blocks.forEach((block) => {
    if (!block.upstream) {
      return;
    }
    block.addresses.forEach((domain) => {
      sites[domain] = block.upstream;
    });
  });
  return sites;
}

function removeDomainBlocksFromContent(content, domain) {
  const parsed = parseTopLevelSiteBlocks(content);
  const ranges = parsed.blocks
    .filter((block) => block.addresses.includes(domain))
    .map((block) => [block.start, block.end]);

  if (!ranges.length) {
    return String(content || "");
  }

  const toRemove = new Set();
  ranges.forEach(([start, end]) => {
    for (let index = start; index <= end; index += 1) {
      toRemove.add(index);
    }
  });

  const nextLines = [];
  for (let index = 0; index < parsed.lines.length; index += 1) {
    if (!toRemove.has(index)) {
      nextLines.push(parsed.lines[index]);
    }
  }

  const compacted = [];
  let previousBlank = false;
  nextLines.forEach((line) => {
    const isBlank = !String(line || "").trim();
    if (isBlank && previousBlank) {
      return;
    }
    compacted.push(line);
    previousBlank = isBlank;
  });
  return `${compacted.join("\n").trimEnd()}\n`;
}

function buildManagedSection(sites) {
  const domains = Object.keys(sites).sort((a, b) => a.localeCompare(b));
  const blocks = domains.map((domain) => {
    const upstream = sites[domain];
    return `${domain} {\n  reverse_proxy ${upstream}\n}`;
  });

  return `${MANAGED_SECTION_START}\n${blocks.join("\n\n")}\n${MANAGED_SECTION_END}`;
}

function updateCaddyfileManagedSectionContent(existing, sites) {
  const managedSection = buildManagedSection(sites);
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

  return next;
}

async function applyReverseProxyConfigChange({ caddyfilePath, domain, sites, status }) {
  const previousManagedSites = await readOptionalFile(MANAGED_SITES_PATH);
  const previousCaddyfile = await readOptionalFile(caddyfilePath);
  const nextManagedSitesContent = JSON.stringify(sites, null, 2);
  const nextCaddyfileContent = updateCaddyfileManagedSectionContent(
    removeDomainBlocksFromContent(previousCaddyfile.content, domain),
    sites
  );

  let validation = { success: false, skipped: true, error: "Caddy is not installed or unavailable in PATH" };
  let reload = { success: false, skipped: true, error: "Caddy is not installed or unavailable in PATH" };

  if (!status.installed || !status.available) {
    return { success: false, validation, reload };
  }

  await writeTextFile(MANAGED_SITES_PATH, nextManagedSitesContent);
  await writeTextFile(caddyfilePath, nextCaddyfileContent);

  try {
    await runCommand("caddy", ["validate", "--config", caddyfilePath, "--adapter", "caddyfile"]);
    validation = { success: true, skipped: false, error: null };
  } catch (error) {
    validation = { success: false, skipped: false, error: error.message };
    await restoreOptionalFile(MANAGED_SITES_PATH, previousManagedSites);
    await restoreOptionalFile(caddyfilePath, previousCaddyfile);
    return { success: false, validation, reload };
  }

  try {
    await runCommand("caddy", ["reload", "--config", caddyfilePath, "--adapter", "caddyfile"]);
    reload = { success: true, skipped: false, error: null };
    return { success: true, validation, reload };
  } catch (error) {
    reload = { success: false, skipped: false, error: error.message };
    await restoreOptionalFile(MANAGED_SITES_PATH, previousManagedSites);
    await restoreOptionalFile(caddyfilePath, previousCaddyfile);
    return { success: false, validation, reload };
  }
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

function getStatusPayload(caddyStatus, installInfo, sites, caddyfileSites) {
  const mergedSites = {
    ...(caddyfileSites || {}),
    ...(sites || {})
  };
  const managedSites = Object.entries(mergedSites)
    .map(([domain, upstream]) => ({ domain, upstream }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    platform: installInfo.platform,
    hostname: os.hostname(),
    caddyfilePath: getCaddyfilePath(),
    installed: caddyStatus.installed,
    available: caddyStatus.available,
    version: caddyStatus.version,
    managedSites,
    installCommands: installInfo.installCommands.map((item) => `${item.command} ${item.args.join(" ")}`)
  };
}

function isWildcardDomain(domain) {
  return String(domain || "").trim().startsWith("*.");
}

async function checkHttpsStatus(domain) {
  const trimmed = String(domain || "").trim().toLowerCase();
  if (!trimmed) {
    return { state: "unknown", message: "Empty domain" };
  }
  if (isWildcardDomain(trimmed)) {
    return { state: "unknown", message: "Wildcard domain cannot be probed directly" };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (socket, payload) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(payload);
      try {
        socket.destroy();
      } catch (_error) {
        // Best-effort cleanup.
      }
    };

    const socket = tls.connect(
      {
        host: trimmed,
        port: 443,
        servername: trimmed,
        rejectUnauthorized: false,
        timeout: 5000
      },
      () => {
        try {
          const certificate = socket.getPeerCertificate(true);
          const rawValidTo = certificate?.valid_to ? String(certificate.valid_to).trim() : "";
          const expiresAt = rawValidTo ? Date.parse(rawValidTo) : NaN;
          const validTo = Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null;
          const expired = Number.isFinite(expiresAt) ? expiresAt <= Date.now() : false;
          const hasCertificate = Boolean(certificate && Object.keys(certificate).length > 0);

          finish(socket, {
            state: validTo ? (expired ? "warning" : "active") : hasCertificate ? "warning" : "unknown",
            message: validTo
              ? (expired ? "Certificate is expired" : "TLS certificate detected")
              : hasCertificate
                ? "TLS certificate detected but expiry could not be parsed"
                : "TLS handshake completed but no certificate details were returned",
            validTo,
            issuer: certificate?.issuer?.O || certificate?.issuer?.CN || null
          });
        } catch (error) {
          finish(socket, {
            state: "warning",
            message: error?.message || "TLS certificate inspection failed"
          });
        }
      }
    );

    socket.on("timeout", () => {
      finish(socket, { state: "inactive", message: "TLS probe timed out on port 443" });
    });
    socket.on("error", (error) => {
      finish(socket, { state: "inactive", message: error?.message || "TLS probe failed" });
    });
  });
}

async function getCaddyStatus() {
  const caddyfilePath = getCaddyfilePath();
  const [caddyStatus, installInfo, sites] = await Promise.all([
    detectCaddy(),
    getInstallInfo(),
    readManagedSites()
  ]);
  const caddyfileSites = await readCaddyfileSites(caddyfilePath);
  const mergedSites = {
    ...(caddyfileSites || {}),
    ...(sites || {})
  };
  const payload = getStatusPayload(caddyStatus, installInfo, sites, caddyfileSites);
  const sslStatusByDomain = {};

  if (!caddyStatus.installed || !caddyStatus.available) {
    Object.keys(mergedSites).forEach((domain) => {
      sslStatusByDomain[domain] = {
        state: "unknown",
        message: "HTTPS probe skipped because Caddy is not installed or unavailable"
      };
    });
  } else {
    await Promise.all(
      Object.keys(mergedSites).map(async (domain) => {
        sslStatusByDomain[domain] = await checkHttpsStatus(domain);
      })
    );
  }

  payload.managedSites = payload.managedSites.map((site) => ({
    ...site,
    https: sslStatusByDomain[site.domain] || { state: "unknown", message: "No TLS data" }
  }));
  return {
    success: true,
    data: payload,
    error: null
  };
}

async function installCaddy() {
  try {
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
        const hinted = withPermissionHint(error?.message || "Install command failed", {
          command: entry.command,
          args: entry.args
        });
        attempts.push({
          command: `${entry.command} ${entry.args.join(" ")}`,
          success: false,
          error: hinted
        });
        return {
          success: false,
          data: { attempts },
          error: `Caddy install failed. ${hinted}`
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
  } catch (error) {
    return {
      success: false,
      data: null,
      error: withPermissionHint(error?.message || "Caddy install failed")
    };
  }
}

async function addReverseProxy(payload = {}) {
  try {
    const domain = sanitizeDomain(payload.domain);
    const upstream = sanitizeUpstream(payload.upstream);

    const status = await detectCaddy();

    const caddyfilePath = getCaddyfilePath();
    const sites = await readManagedSites();
    sites[domain] = upstream;
    const { success: operationSuccess, validation, reload } = await applyReverseProxyConfigChange({
      caddyfilePath,
      domain,
      sites,
      status
    });

    const warnings = [];
    if (!validation.success) {
      warnings.push(validation.error);
    }
    if (!reload.success) {
      warnings.push(reload.error);
    }

    return {
      success: operationSuccess,
      data: {
        domain,
        upstream,
        caddyfilePath,
        validation,
        reload,
        warnings
      },
      error: operationSuccess ? null : "Caddy validate/reload failed"
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: withPermissionHint(error?.message || "Failed to add reverse proxy")
    };
  }
}

async function deleteReverseProxy(payload = {}) {
  try {
    const domain = sanitizeDomain(payload.domain);

    const status = await detectCaddy();

    const caddyfilePath = getCaddyfilePath();
    const sites = await readManagedSites();
    delete sites[domain];
    const { success: operationSuccess, validation, reload } = await applyReverseProxyConfigChange({
      caddyfilePath,
      domain,
      sites,
      status
    });

    const warnings = [];
    if (!validation.success) {
      warnings.push(validation.error);
    }
    if (!reload.success) {
      warnings.push(reload.error);
    }

    return {
      success: operationSuccess,
      data: {
        domain,
        caddyfilePath,
        validation,
        reload,
        warnings
      },
      error: operationSuccess ? null : "Caddy validate/reload failed"
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: withPermissionHint(error?.message || "Failed to delete reverse proxy")
    };
  }
}

async function restartCaddyService() {
  try {
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
          error: withPermissionHint(error?.message || "Restart command failed", {
            command: entry.command,
            args: entry.args
          })
        });
      }
    }

    return {
      success: false,
      data: { attempts, platform },
      error: "Unable to restart Caddy service with available commands"
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      error: withPermissionHint(error?.message || "Unable to restart Caddy service")
    };
  }
}

module.exports = {
  getCaddyStatus,
  installCaddy,
  addReverseProxy,
  deleteReverseProxy,
  restartCaddyService,
  __test: {
    buildManagedSection,
    removeDomainBlocksFromContent,
    updateCaddyfileManagedSectionContent
  }
};

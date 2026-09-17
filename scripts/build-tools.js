#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

/**
 * Native dependency preflight for the pm2-manager installer.
 *
 * Several of our dependencies compile C/C++ code through node-gyp during
 * `npm install` (node-pty for the browser terminal is the important one).
 * A fresh Ubuntu/Debian VPS ships without the toolchain, and npm answers with
 * hundreds of `gyp ERR!` lines that hide the real problem. This module detects
 * the missing tools before npm runs, installs them when we are allowed to, and
 * otherwise fails with one actionable command the operator can paste.
 */

// Packages that build native code during install. Keep this list explicit: it
// drives whether we require a compiler toolchain at all.
const NATIVE_DEPENDENCY_NAMES = new Set([
  "argon2",
  "bcrypt",
  "better-sqlite3",
  "canvas",
  "keytar",
  "leveldown",
  "node-gyp",
  "node-pty",
  "node-sass",
  "re2",
  "serialport",
  "sharp",
  "sodium-native",
  "sqlite",
  "sqlite3",
  "usb",
  "zeromq"
]);

// node-gyp needs make, a C/C++ compiler and Python 3 on Linux.
const TOOLCHAIN_REQUIREMENTS = {
  linux: [
    { id: "make", commands: ["make"], label: "GNU make" },
    { id: "gcc", commands: ["gcc", "cc"], label: "C compiler" },
    { id: "g++", commands: ["g++", "c++"], label: "C++ compiler" },
    { id: "python3", commands: ["python3", "python"], label: "Python 3" }
  ],
  darwin: [
    { id: "make", commands: ["make"], label: "GNU make" },
    { id: "python3", commands: ["python3", "python"], label: "Python 3" }
  ],
  // node-pty ships prebuilt binaries on Windows, so we never block there.
  win32: []
};

const DEBIAN_PACKAGES = ["build-essential", "python3"];
const REDHAT_PACKAGES = ["make", "gcc", "gcc-c++", "python3"];

function hasCommandFactory(platform = process.platform) {
  const probe = platform === "win32" ? "where" : "which";
  return function commandExists(command) {
    try {
      const result = spawnSync(probe, [command], { stdio: "ignore" });
      return result.status === 0;
    } catch (_error) {
      return false;
    }
  };
}

function readPackageJson(packageDir) {
  try {
    const raw = fs.readFileSync(path.join(packageDir, "package.json"), "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

// Detects which package manager (and how to elevate) applies on this machine,
// then turns that into the install plan used for guidance and auto-install.
function detectPlan(platform = process.platform, commandExists = hasCommandFactory(platform)) {
  const availableCommands = {
    "apt-get": commandExists("apt-get"),
    dnf: commandExists("dnf"),
    yum: commandExists("yum"),
    pacman: commandExists("pacman"),
    zypper: commandExists("zypper"),
    apk: commandExists("apk")
  };
  const elevationCommand = commandExists("sudo") ? "sudo" : commandExists("doas") ? "doas" : null;
  return buildToolInstallPlan(platform, availableCommands, elevationCommand);
}

function findNativeDependencies(packageJson) {
  if (!packageJson || typeof packageJson !== "object") {
    return [];
  }

  const sources = [packageJson.dependencies, packageJson.optionalDependencies];
  const found = new Set();
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    for (const name of Object.keys(source)) {
      if (NATIVE_DEPENDENCY_NAMES.has(String(name).toLowerCase())) {
        found.add(String(name));
      }
    }
  }

  return Array.from(found).sort();
}

function platformToolchain(platform = process.platform) {
  return TOOLCHAIN_REQUIREMENTS[platform] || [];
}

function detectMissingTools(platform = process.platform, commandExists = hasCommandFactory(platform)) {
  const missing = [];
  for (const requirement of platformToolchain(platform)) {
    const available = requirement.commands.some((command) => commandExists(command));
    if (!available) {
      missing.push(requirement);
    }
  }
  return missing;
}

function buildToolInstallPlan(
  platform = process.platform,
  availableCommands = {},
  elevationCommand = null
) {
  const available = (name) => Boolean(availableCommands[name]);
  const prefix = (commands, { elevated = false } = {}) =>
    commands.map((command) => (elevated && elevationCommand ? `${elevationCommand} ${command}` : command));

  if (platform === "darwin") {
    return {
      supported: true,
      required: "Xcode command line tools (make, clang) and Python 3",
      commands: prefix(["xcode-select --install"]),
      note: "Install Xcode command line tools, then re-run the installer."
    };
  }

  if (platform !== "linux") {
    if (platform === "win32") {
      // Windows installs normally use prebuilt binaries, so a local compile only
      // happens after a build failure. Give the operator the exact recovery path.
      return {
        supported: false,
        required: "Visual Studio Build Tools (Desktop development with C++) and Python 3",
        commands: [
          'winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
          "winget install --id Python.Python.3.12"
        ],
        note: "Windows uses prebuilt binaries when available; if a module must compile, node-gyp needs the Visual Studio Build Tools C++ workload and Python 3."
      };
    }

    return {
      supported: false,
      required: "A C/C++ toolchain and Python 3",
      commands: [],
      note: "Install a C/C++ toolchain and Python 3, then re-run the installer."
    };
  }

  if (available("apt-get")) {
    return {
      supported: true,
      required: "build-essential python3",
      commands: prefix(["apt-get update"], { elevated: true }).concat(
        prefix([`apt-get install -y ${DEBIAN_PACKAGES.join(" ")}`], { elevated: true })
      ),
      note: "Ubuntu/Debian need build-essential and python3 for node-gyp."
    };
  }

  if (available("dnf") || available("yum")) {
    const manager = available("dnf") ? "dnf" : "yum";
    return {
      supported: true,
      required: REDHAT_PACKAGES.join(" "),
      commands: prefix([`${manager} install -y ${REDHAT_PACKAGES.join(" ")}`], { elevated: true }),
      note: "RHEL/Fedora need gcc, gcc-c++ and python3 for node-gyp."
    };
  }

  if (available("pacman")) {
    return {
      supported: true,
      required: "base-devel python",
      commands: prefix(["pacman -Sy --noconfirm base-devel python"], { elevated: true }),
      note: "Arch needs base-devel and python for node-gyp."
    };
  }

  if (available("zypper")) {
    return {
      supported: true,
      required: REDHAT_PACKAGES.join(" "),
      commands: prefix([`zypper --non-interactive install ${REDHAT_PACKAGES.join(" ")}`], { elevated: true }),
      note: "openSUSE needs gcc, gcc-c++ and python3 for node-gyp."
    };
  }

  if (available("apk")) {
    return {
      supported: true,
      required: "build-base python3",
      commands: prefix(["apk add --no-cache build-base python3"], { elevated: true }),
      note: "Alpine needs build-base and python3 for node-gyp."
    };
  }

  return {
    supported: false,
    required: "build-essential python3",
    // We cannot detect the package manager, so we never run these; we still
    // print the Ubuntu/Debian command because that is the common case, and the
    // operator can adapt it.
    commands: prefix(["apt-get update"], { elevated: true }).concat(
      prefix([`apt-get install -y ${DEBIAN_PACKAGES.join(" ")}`], { elevated: true })
    ),
    note: "No supported package manager was detected. On Ubuntu/Debian run the commands above; otherwise install a C/C++ toolchain and Python 3 with your package manager."
  };
}

function formatMissingToolchainMessage({ platform, missingTools, plan, packageDir, nativeDependencies, reason }) {
  const lines = [];
  const packageName = packageDir ? path.basename(packageDir) : "package";
  const tools = (missingTools || []).map((tool) => `${tool.label || tool.id} (${tool.id})`);
  const deps = (nativeDependencies || []).join(", ");

  lines.push(reason || (platform === "win32"
    ? "Native compilation failed and the required build tools were not found."
    : "Native build tools are missing."));
  if (deps) {
    lines.push(`- ${packageName} depends on native modules that compile during install: ${deps}`);
  }
  if (tools.length > 0) {
    lines.push(`- Missing: ${tools.join(", ")}`);
  }
  if (plan?.required) {
    lines.push(`- Required packages: ${plan.required}`);
  }
  if (plan?.commands?.length) {
    lines.push("- Fix it with:");
    for (const command of plan.commands) {
      lines.push(`    ${command}`);
    }
  }
  if (plan?.note) {
    lines.push(`- ${plan.note}`);
  }
  lines.push("- Then re-run: npm run setup");

  return lines.join("\n");
}

function isNativeBuildError(output) {
  const text = String(output || "");
  return (
    /gyp ERR!/i.test(text) ||
    /node-gyp/i.test(text) ||
    /not found: make/i.test(text) ||
    /not found: g\+\+/i.test(text) ||
    /gyp: No Xcode or CLT version detected/i.test(text)
  );
}

// Roughly the lines that explain a native build failure. Everything else in the
// npm log (optional esbuild platform notices, audit noise, progress output) is
// intentionally dropped so the operator sees the real cause.
const NOISE_PATTERNS = [
  /^npm (warn|notice)/i,
  /EBADPLATFORM/i,
  /esbuild/i,
  /optional dep/i,
  /funding/i,
  /^added \d+/i,
  /^up to date/i
];

function extractBuildErrorExcerpt(output, maxLines = 14) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const relevant = lines.filter((line) => {
    if (/gyp|node-gyp|make:|not found|command not found|python/i.test(line)) {
      return true;
    }
    if (/^npm (error|ERR!)/i.test(line)) {
      return true;
    }
    return false;
  });
  const filtered = relevant.filter((line) => !NOISE_PATTERNS.some((pattern) => pattern.test(line)));
  const excerpt = (filtered.length > 0 ? filtered : lines).slice(0, maxLines);

  // Prefer lines that name the missing executable, then the gyp header line.
  const anchorIndex = excerpt.findIndex((line) => /not found: (make|g\+\+|cc|gcc|python)/i.test(line));
  const head = excerpt.find((line) => /^gyp ERR! build error/i.test(line));
  if (head && anchorIndex === -1) {
    return [head, ...excerpt.filter((line) => line !== head).slice(0, maxLines - 1)];
  }

  return excerpt;
}

function formatNativeBuildFailure({ name, packageDir, nativeDependencies, plan, output }) {
  const excerpt = extractBuildErrorExcerpt(output);
  const lines = [];
  lines.push(`[${name}] npm install failed while compiling native dependencies${nativeDependencies?.length ? `: ${nativeDependencies.join(", ")}` : ""}.`);
  if (excerpt.length > 0) {
    lines.push("");
    lines.push("Relevant log lines:");
    for (const line of excerpt) {
      lines.push(`  ${line}`);
    }
  }
  lines.push("");
  lines.push(formatMissingToolchainMessage({
    platform: process.platform,
    missingTools: [],
    reason: "Native modules failed to compile, which usually means the build toolchain is missing.",
    // Fall back to a freshly detected plan when the caller had none (for example
    // when the preflight was skipped), so guidance is never missing.
    plan: plan || detectPlan(),
    packageDir,
    nativeDependencies
  }));
  lines.push("(Optional esbuild platform-availability warnings and audit notices are unrelated to this failure.)");
  return lines.join("\n");
}

function checkBuildTools({
  packageDir,
  platform = process.platform,
  commandExists = hasCommandFactory(platform)
} = {}) {
  const packageJson = readPackageJson(packageDir || process.cwd());
  const nativeDependencies = findNativeDependencies(packageJson);
  const toolchain = platformToolchain(platform);

  const availableCommands = {
    "apt-get": commandExists("apt-get"),
    dnf: commandExists("dnf"),
    yum: commandExists("yum"),
    pacman: commandExists("pacman"),
    zypper: commandExists("zypper"),
    apk: commandExists("apk")
  };
  const elevationCommand = commandExists("sudo") ? "sudo" : commandExists("doas") ? "doas" : null;

  // Build the plan even when no toolchain probe applies (Windows, unknown OS) so
  // a later compile failure can still print actionable guidance.
  const plan = detectPlan(platform, commandExists);

  if (nativeDependencies.length === 0 || toolchain.length === 0) {
    return {
      required: false,
      nativeDependencies,
      missingTools: [],
      toolchain,
      plan,
      packageDir
    };
  }

  const missingTools = detectMissingTools(platform, commandExists);

  return {
    required: missingTools.length > 0,
    nativeDependencies,
    missingTools,
    toolchain,
    plan,
    availableCommands,
    elevationCommand,
    packageDir
  };
}

function canInstallWithoutPrompt(platform = process.platform, commandExists = hasCommandFactory(platform)) {
  if (platform !== "linux") {
    return false;
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return true;
  }
  for (const candidate of ["sudo", "doas"]) {
    if (!commandExists(candidate)) {
      continue;
    }
    try {
      const probe = spawnSync(candidate, ["-n", "true"], { stdio: "ignore" });
      if (probe.status === 0) {
        return true;
      }
    } catch (_error) {
      // Fall through to the next candidate.
    }
  }
  return false;
}

function runInstallPlan(commands, { cwd = process.cwd() } = {}) {
  for (const command of commands) {
    const result = spawnSync(command, {
      cwd,
      shell: true,
      stdio: "inherit"
    });
    if (result.status !== 0) {
      return { ok: false, command, status: result.status };
    }
  }
  return { ok: true };
}

function ensureBuildTools({
  packageDir,
  platform = process.platform,
  allowInstall = true,
  commandExists = hasCommandFactory(platform),
  install = runInstallPlan,
  canInstall = canInstallWithoutPrompt,
  logger = console
} = {}) {
  const check = checkBuildTools({ packageDir, platform, commandExists });
  if (!check.required) {
    return { ...check, ok: true, installed: false };
  }

  const missing = check.missingTools.map((tool) => tool.id).join(", ");
  const installAllowed = allowInstall && check.plan?.supported && check.plan?.commands?.length > 0;

  if (!installAllowed) {
    return { ...check, ok: false, installed: false, error: formatMissingToolchainMessage(check) };
  }

  if (!canInstall(platform, commandExists)) {
    return {
      ...check,
      ok: false,
      installed: false,
      elevated: true,
      error: formatMissingToolchainMessage(check)
    };
  }

  logger.log(`Native build tools are missing (${missing}). Installing them before npm runs...`);
  const installResult = install(check.plan.commands, { cwd: packageDir });
  if (!installResult.ok) {
    return {
      ...check,
      ok: false,
      installed: false,
      error: `Failed to install native build tools (${installResult.command}).\n\n${formatMissingToolchainMessage(check)}`
    };
  }

  const recheck = checkBuildTools({ packageDir, platform, commandExists });
  if (recheck.required) {
    return {
      ...recheck,
      ok: false,
      installed: true,
      error: `Native build tools are still missing after install.\n\n${formatMissingToolchainMessage(recheck)}`
    };
  }

  logger.log("Native build tools are ready.");
  return { ...recheck, ok: true, installed: true };
}

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--dir") {
      values.dir = String(argv[index + 1] || "");
      index += 1;
    } else if (token.startsWith("--dir=")) {
      values.dir = token.slice(6);
    } else if (token === "--repo") {
      values.repo = String(argv[index + 1] || "");
      index += 1;
    } else if (token.startsWith("--repo=")) {
      values.repo = token.slice(7);
    } else if (token.startsWith("--")) {
      flags.add(token);
    }
  }
  return { flags, values };
}

function printCheckResult(result, { json = false, quiet = false } = {}) {
  const nativeDependencies = result.nativeDependencies || [];
  if (json) {
    console.log(JSON.stringify({
      ok: result.ok !== false,
      required: Boolean(result.required),
      nativeDependencies,
      missingTools: (result.missingTools || []).map((tool) => tool.id),
      commands: result.plan?.commands || [],
      error: result.error || null
    }));
    return;
  }

  if (nativeDependencies.length === 0) {
    if (!quiet) {
      console.log("No native build dependencies detected; no C/C++ toolchain required.");
    }
    return;
  }

  if (!result.required) {
    if (!quiet) {
      console.log(`Native build dependencies detected (${nativeDependencies.join(", ")}); build tools are present.`);
    }
    return;
  }

  // Failures are always printed, even in quiet mode (npm preinstall uses --quiet).
  console.log(result.error || formatMissingToolchainMessage(result));
}

function main(argv = process.argv.slice(2)) {
  const { flags, values } = parseArgs(argv);
  const shouldEnsure = flags.has("--ensure") || flags.has("--fix");
  const json = flags.has("--json");
  const quiet = !json && flags.has("--quiet");
  const logger = json ? { log: () => {} } : console;
  const scanAll = flags.has("--scan");
  const repoRoot = values.repo || process.cwd();
  const packageDirs = (scanAll
    ? [repoRoot, path.join(repoRoot, "server"), path.join(repoRoot, "client")]
    : [values.dir || repoRoot]
  ).map((entry) => path.resolve(entry));

  const results = [];
  for (const packageDir of packageDirs) {
    let result;
    if (shouldEnsure) {
      result = ensureBuildTools({ packageDir, logger });
    } else {
      // --check is the default behavior: verify without touching the system.
      result = checkBuildTools({ packageDir });
      result.ok = !result.required;
    }
    result.packageDir = packageDir;
    results.push(result);

    if (!json && (result.nativeDependencies || []).length > 0) {
      const relative = path.relative(process.cwd(), packageDir);
      const label = !relative
        ? path.basename(packageDir) || "."
        : relative.startsWith("..")
          ? packageDir
          : relative;
      // Stay silent on success when --quiet is set (npm preinstall runs this on
      // every install), but never hide a failure.
      if (!quiet) {
        console.log(`[${label}]`);
      }
      printCheckResult(result, { json, quiet });
    } else if (json) {
      printCheckResult(result, { json });
    }
  }

  if (!json && !quiet && results.every((entry) => (entry.nativeDependencies || []).length === 0)) {
    console.log("No native build dependencies detected; no C/C++ toolchain required.");
  }

  const failed = results.filter((entry) => entry.ok === false);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
  return results.length === 1 ? results[0] : results;
}

module.exports = {
  NATIVE_DEPENDENCY_NAMES,
  readPackageJson,
  findNativeDependencies,
  platformToolchain,
  detectMissingTools,
  buildToolInstallPlan,
  detectPlan,
  formatMissingToolchainMessage,
  isNativeBuildError,
  extractBuildErrorExcerpt,
  formatNativeBuildFailure,
  checkBuildTools,
  canInstallWithoutPrompt,
  runInstallPlan,
  ensureBuildTools,
  parseArgs,
  main
};

if (require.main === module) {
  main();
}

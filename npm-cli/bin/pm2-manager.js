#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const DEFAULT_REPO_URL = "https://github.com/AnonymousSysna/pm2-manager.git";
const APP_NAME = "pm2-dashboard";

function isWindows() {
  return process.platform === "win32";
}

function npmCmd() {
  return isWindows() ? "npm.cmd" : "npm";
}

function gitCmd() {
  return isWindows() ? "git.exe" : "git";
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    stdio: options.stdio || "inherit",
    env: process.env,
    shell: false
  });

  if (result.error) {
    throw result.error;
  }

  const code = Number(result.status || 0);
  if (!options.allowFail && code !== 0) {
    process.exit(code);
  }

  return code;
}

function parseArgs(argv) {
  const out = {
    dir: process.env.PM2_MANAGER_DIR || path.join(os.homedir(), "pm2-manager"),
    repo: process.env.REPO_URL || DEFAULT_REPO_URL,
    logs: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dir" && argv[i + 1]) {
      out.dir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      out.dir = arg.slice("--dir=".length);
      continue;
    }
    if (arg === "--repo" && argv[i + 1]) {
      out.repo = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      out.repo = arg.slice("--repo=".length);
      continue;
    }
    if (arg === "--logs") {
      out.logs = true;
      continue;
    }
    if (!arg.startsWith("-") && out.dir === path.join(os.homedir(), "pm2-manager")) {
      out.dir = arg;
    }
  }

  out.dir = path.resolve(out.dir);
  return out;
}

function isPm2ManagerDir(dir) {
  const pkg = path.join(dir, "package.json");
  if (!fs.existsSync(pkg)) {
    return false;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(pkg, "utf8"));
    return parsed && parsed.name === APP_NAME;
  } catch (_error) {
    return false;
  }
}

function ensureRepo(appDir, repoUrl) {
  if (isPm2ManagerDir(process.cwd())) {
    return process.cwd();
  }

  const gitDir = path.join(appDir, ".git");
  if (fs.existsSync(gitDir)) {
    console.log(`Pulling latest in ${appDir}...`);
    run(gitCmd(), ["-C", appDir, "pull", "--ff-only"]);
    return appDir;
  }

  if (fs.existsSync(appDir)) {
    const entries = fs.readdirSync(appDir);
    if (entries.length > 0) {
      throw new Error(`Target directory exists and is not empty: ${appDir}`);
    }
  }

  console.log(`Cloning ${repoUrl} into ${appDir}...`);
  run(gitCmd(), ["clone", repoUrl, appDir]);
  return appDir;
}

function ensureEnv(appDir) {
  const envPath = path.join(appDir, ".env");
  if (fs.existsSync(envPath)) {
    return;
  }

  const envExamplePath = path.join(appDir, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
  } else {
    fs.writeFileSync(envPath, "", "utf8");
  }

  const pm2User = `admin_${crypto.randomBytes(3).toString("hex")}`;
  const pm2Pass = crypto.randomBytes(12).toString("base64url");
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  const metricsToken = crypto.randomBytes(32).toString("hex");

  const block = [
    "",
    "# one-tap generated credentials",
    `PM2_USER=${pm2User}`,
    `PM2_PASS=${pm2Pass}`,
    `JWT_SECRET=${jwtSecret}`,
    `METRICS_TOKEN=${metricsToken}`,
    "CORS_ALLOWED_ORIGINS=http://localhost:8000",
    ""
  ].join("\n");

  fs.appendFileSync(envPath, block, "utf8");

  console.log("Created .env with generated credentials:");
  console.log(`Login user: ${pm2User}`);
  console.log(`Login pass: ${pm2Pass}`);
}

function installAndBuild(appDir) {
  console.log("Installing dependencies...");
  run(npmCmd(), ["install"], { cwd: appDir });
  run(npmCmd(), ["--prefix", "server", "install"], { cwd: appDir });
  run(npmCmd(), ["--prefix", "client", "install"], { cwd: appDir });

  console.log("Building client...");
  run(npmCmd(), ["run", "build"], { cwd: appDir });
}

function startWithPm2(appDir, tailLogs) {
  const checkCode = run(
    npmCmd(),
    ["--prefix", "server", "exec", "pm2", "--", "describe", APP_NAME],
    { cwd: appDir, stdio: "ignore", allowFail: true }
  );

  if (checkCode === 0) {
    console.log("Restarting existing process...");
    run(npmCmd(), ["run", "pm2:restart"], { cwd: appDir });
  } else {
    console.log("Starting process...");
    run(npmCmd(), ["run", "pm2:start"], { cwd: appDir });
  }

  console.log("Done. Open http://localhost:8000");

  if (tailLogs) {
    run(npmCmd(), ["run", "pm2:logs"], { cwd: appDir });
  }
}

function requireCommand(command, versionArgs) {
  const code = run(command, versionArgs, { stdio: "ignore", allowFail: true });
  if (code !== 0) {
    throw new Error(`Missing required command: ${command}`);
  }
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    requireCommand(gitCmd(), ["--version"]);
    requireCommand("node", ["--version"]);
    requireCommand(npmCmd(), ["--version"]);

    const appDir = ensureRepo(args.dir, args.repo);
    installAndBuild(appDir);
    ensureEnv(appDir);
    startWithPm2(appDir, args.logs);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();

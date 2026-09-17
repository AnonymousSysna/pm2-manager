const fs = require("fs");
const path = require("path");

const appRoot = __dirname;
const serverRoot = path.join(appRoot, "server");
const envPath = path.join(appRoot, ".env");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const fileEnv = parseEnvFile(envPath);

module.exports = {
  apps: [
    {
      name: "pm2-dashboard",
      cwd: serverRoot,
      script: path.join(serverRoot, "index.ts"),
      interpreter: "node",
      node_args: "--import tsx",
      instances: 1,
      exec_mode: "fork",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        PM2_MANAGER_PROCESS_NAME: "pm2-dashboard"
      },
      watch: false,
      autorestart: true,
      max_memory_restart: "300M",
      error_file: path.join(appRoot, "logs", "err.log"),
      out_file: path.join(appRoot, "logs", "out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};

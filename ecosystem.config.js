const fs = require("fs");
const path = require("path");
const { buildProcessEnv } = require("./scripts/env-file");

const appRoot = __dirname;
const serverRoot = path.join(appRoot, "server");
const envPath = path.join(appRoot, ".env");

// Same precedence as server/utils/envLoad.ts: .env.<NODE_ENV> wins over .env,
// and real process env still wins over everything PM2 injects here.
const { nodeEnv, values: fileEnv } = buildProcessEnv({
  appRoot,
  serverRoot,
  nodeEnv: process.env.NODE_ENV || "production"
});

if (!fs.existsSync(envPath)) {
  console.warn(
    `[pm2] No ${envPath} found. Run "npm run env:bootstrap" so the app never starts with placeholder credentials.`
  );
}

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
        NODE_ENV: nodeEnv,
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

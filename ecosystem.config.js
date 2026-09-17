const path = require("path");

const appRoot = __dirname;
const serverRoot = path.join(appRoot, "server");

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
        NODE_ENV: "production"
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

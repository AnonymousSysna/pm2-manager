module.exports = {
  apps: [
    {
      name: "pm2-dashboard",
      script: "./server/index.ts",
      interpreter: "node",
      node_args: "--import tsx",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8000
      },
      watch: false,
      autorestart: true,
      max_memory_restart: "300M",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};

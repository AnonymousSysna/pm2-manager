# PM2 Dashboard

Web app for operating PM2-managed services with real-time monitoring, deployment tools, audit history, dotenv editing, and optional Caddy reverse-proxy management.

- Backend: Express + Socket.IO in `server/`
- Frontend: React + Vite + Tailwind in `client/`
- Auth: JWT cookies plus CSRF protection
- Default app URL: `http://<host>:8000`

## What It Includes

- Process lifecycle controls: start, stop, restart, reload, delete
- Create / duplicate / deploy / rollback workflows
- Live metrics, logs, restart history, deployment history, audit trail
- Alert channel management and notification history
- Process metadata and `.env` editing
- PM2 daemon actions
- Optional Caddy install / status / reverse proxy management
- Interpreter detection

## Choose Your Flow

Use one of these paths:

1. Quick install with the one-tap installer
2. Manual production install on a server
3. Local development

If you already have the app installed and only want to update it, jump to `Updating an Existing Install`.

## Requirements

- Node.js 18+ (`20+` recommended)
- npm
- git

Caddy is optional. The app should work without it.

## Quick Install

### Linux or macOS

```bash
curl -fsSL https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.sh | bash
```

### Linux or macOS with SSL setup

```bash
curl -fsSL https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.sh | bash -s -- --setup-ssl --domain pm2.example.com
```

### Windows PowerShell

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.ps1 | iex"
```

### Windows PowerShell with SSL setup

```powershell
$env:PM2_MANAGER_SETUP_SSL="true"
$env:PM2_MANAGER_DOMAIN="pm2.example.com"
powershell -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.ps1 | iex"
```

### What the installer does

- Clones or updates the repo
- Installs dependencies
- Builds the client
- Bootstraps `.env` if needed
- Starts or restarts the dashboard with PM2
- Optionally installs and configures Caddy if you requested SSL and the current shell has enough privilege

### Important note about SSL

The installer treats app install and SSL setup as separate phases:

- Base install can succeed without Caddy
- SSL setup only succeeds after DNS, domain, and system privilege requirements are satisfied
- If SSL setup cannot be completed, the dashboard should still be usable on its app port

## Manual Production Install

Use this if you want the cleanest step-by-step server setup.

### 1. Clone the repo

```bash
git clone https://github.com/AnonymousSysna/pm2-manager.git
cd pm2-manager
```

### 2. Install dependencies

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 3. Create the environment file

```bash
cp .env.example .env
```

Required keys:

```env
PM2_USER=replace_with_admin_username
PM2_PASS_HASH=$2a$10$replace_with_bcrypt_hash
JWT_SECRET=replace_with_long_random_secret
METRICS_TOKEN=replace_with_long_random_token
```

### 4. Build the client

```bash
npm run build
```

Important:

- `npm run build` builds the frontend into `client/dist`
- Pulling new code is not enough for frontend changes; you must rebuild before restarting production

### 5. Start the dashboard with PM2

```bash
npm run pm2:start
```

Optional but recommended after confirming it works:

```bash
npm run pm2:save
```

### 6. Open the app

Visit:

```text
http://<server-ip>:8000
```

### 7. Only if you want a domain and HTTPS: install Caddy later

You do not need Caddy for the base app to run.

- Install Caddy from the `Extensions` page, or
- Re-run the one-tap installer with SSL options, or
- Install Caddy manually and configure reverse proxy later

## Updating an Existing Install

This is the safe update flow:

### 1. Pull the latest code

```bash
cd ~/pm2-manager
git pull
```

### 2. Install dependencies if package files changed

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 3. Rebuild the client

```bash
npm run build
```

### 4. Restart the app

```bash
pm2 restart pm2-dashboard --update-env
```

Or from the repo:

```bash
npm run pm2:restart
```

### 5. Verify logs if something looks wrong

```bash
tail -n 100 logs/err.log
tail -n 100 logs/out.log
```

## Local Development

### 1. Install dependencies

```bash
npm install
npm --prefix server install
npm --prefix client install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

### 3. Start both apps

```bash
npm run dev
```

Defaults:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health endpoint: `http://localhost:8000/health`

When `VITE_API_URL` is unset, Vite proxies `/api` and `/socket.io` to the backend.

## One-Tap Installer Options

Supported overrides:

- `REPO_URL=<git-url>`
- `PM2_MANAGER_DIR=<install-path>`
- `PM2_MANAGER_PORT=<port>` or `--port <port>`
- `PM2_MANAGER_DOMAIN=<fqdn>` or `--domain <fqdn>`
- `PM2_MANAGER_SETUP_SSL=true|false` or `--setup-ssl` / `--no-setup-ssl`
- `PM2_MANAGER_INSTALL_CADDY=true|false` or `--install-caddy` / `--no-install-caddy`
- `PM2_MANAGER_UPSTREAM=<host:port>` or `--upstream <host:port>`

If you are already inside this repo:

```bash
npm run onetap -- --port 8000
```

With SSL:

```bash
npm run onetap -- --setup-ssl --domain pm2.example.com
```

## Environment Variables

Use `.env.example` as the starting point.

Core runtime defaults:

```env
PORT=8000
AUTH_ALLOWED_IPS=
TRUST_PROXY=0
COOKIE_SECURE=
CORS_ALLOWED_ORIGINS=http://localhost:5173
PROJECTS_ROOT=/user/pm2-manager/apps/
COMMAND_TIMEOUT_MS=300000
LOG_TAIL_MAX_BYTES=1048576
```

Advanced optional keys supported by the backend:

```env
# Auth/session tuning
ACCESS_TOKEN_TTL_SEC=900
REFRESH_TOKEN_TTL_SEC=604800

# Health/metrics endpoint controls
HEALTHCHECK_TIMEOUT_MS=5000
METRICS_RATE_LIMIT_MAX=20

# Process startup health checks
START_HEALTHCHECK_TIMEOUT_MS=12000
START_HEALTHCHECK_STABILITY_MS=3000

# PM2 daemon
PM2_HOME=

# Caddy integration
CADDYFILE_PATH=/etc/caddy/Caddyfile
CADDY_MANAGED_SITES_PATH=./logs/caddy-managed-sites.json

# Process metadata/config stores
PROCESS_META_PATH=./logs/process-meta.json

# Restart history
RESTART_HISTORY_PATH=./logs/restart-history.jsonl
RESTART_HISTORY_MAX_LINES=20000
RESTART_HISTORY_MAX_BYTES=10485760

# Deployment history
DEPLOY_HISTORY_PATH=./logs/deploy-history.jsonl
DEPLOY_HISTORY_MAX_LINES=5000
DEPLOY_HISTORY_MAX_BYTES=5242880

# Audit trail
AUDIT_TRAIL_PATH=./logs/audit-trail.jsonl
AUDIT_TRAIL_MAX_LINES=50000
AUDIT_TRAIL_MAX_BYTES=26214400

# Alerts and notifications
ALERT_CHANNELS_PATH=./logs/alert-channels.json
ALERT_TIMEOUT_MS=8000
NOTIFICATION_HISTORY_PATH=./logs/notifications.jsonl
NOTIFICATION_MAX_LINES=20000
NOTIFICATION_MAX_BYTES=10485760

# Metrics history storage
METRICS_HISTORY_PATH=./logs/metrics-history.json
METRICS_HISTORY_MAX_POINTS=4320
METRICS_HISTORY_RETENTION_POINTS=4320
METRICS_HISTORY_MAX_AGE_MS=0
METRICS_HISTORY_WRITE_THROTTLE_MS=1000
```

Notes:

- `AUTH_ALLOWED_IPS` is a comma-separated allowlist for login, API, socket, and metrics access
- `TRUST_PROXY=1` should be set behind a reverse proxy
- `COOKIE_SECURE` can be empty, `true`, or `false`
- `CORS_ALLOWED_ORIGINS` accepts comma-separated origins
- You can use `PM2_PASS` or `PM2_PASS_HASH`; hashed is recommended

## Password Hash Setup

```bash
cd server
node -e "const bcrypt=require('bcryptjs'); const p=process.argv[1]; if(!p){process.exit(1);} console.log(bcrypt.hashSync(p,10));" "YourStrongPassword"
```

## PM2 Commands

From the repo root:

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:restart
npm run pm2:stop
npm run pm2:save
```

One-command deploy:

```bash
npm run deploy
```

## Caddy Notes

- Caddy is optional
- The dashboard should run without Caddy installed
- `GET /api/v1/caddy/status` is an authenticated API route, not a public page
- If you open API routes directly in the browser, expect JSON responses, not HTML pages
- A healthy unauthenticated hit to `/api/v1/caddy/status` should return `401`, not a rendered page

## Troubleshooting

### I pulled the latest code but nothing changed

You probably forgot the client build step.

Run:

```bash
git pull
npm run build
pm2 restart pm2-dashboard --update-env
```

### `/api/v1/caddy/status` returns `ERR_EMPTY_RESPONSE`

Check the backend logs:

```bash
tail -f logs/err.log logs/out.log
```

Then test locally on the server:

```bash
curl -i http://127.0.0.1:8000/api/v1/caddy/status
```

Notes:

- This route requires auth
- If the app is healthy, an unauthenticated request should return `401` JSON
- If the browser shows `ERR_EMPTY_RESPONSE`, the backend is usually crashing or resetting the connection

### I want to know what process is serving port `8000`

```bash
ss -ltnp | grep :8000
pm2 show pm2-dashboard
```

### I restarted PM2 but need fresh logs

```bash
pm2 flush
pm2 restart pm2-dashboard --update-env
tail -f logs/err.log logs/out.log
```

### Caddy is not installed yet

That should not prevent the dashboard from starting.

Base app first, reverse proxy later.

## API Overview

Base paths:

- Primary: `/api/v1/...`
- Compatibility alias: `/api/...`

### Auth

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`

### Processes

- `GET /api/v1/processes`
- `GET /api/v1/processes/catalog`
- `GET /api/v1/processes/interpreters`
- `GET /api/v1/processes/monitoring/summary`
- `GET /api/v1/processes/history/restarts`
- `GET /api/v1/processes/history/deployments`
- `GET /api/v1/processes/history/audit`
- `GET /api/v1/processes/config/export`
- `POST /api/v1/processes/config/import`
- `GET /api/v1/processes/:name`
- `GET /api/v1/processes/:name/metrics`
- `PATCH /api/v1/processes/:name/meta`
- `DELETE /api/v1/processes/:name/meta`
- `POST /api/v1/processes/create`
- `POST /api/v1/processes/bulk-action`
- `POST /api/v1/processes/:name/start`
- `POST /api/v1/processes/:name/stop`
- `POST /api/v1/processes/:name/restart`
- `POST /api/v1/processes/:name/reload`
- `PATCH /api/v1/processes/:name/env`
- `GET /api/v1/processes/:name/dotenv`
- `PATCH /api/v1/processes/:name/dotenv`
- `POST /api/v1/processes/:name/npm-install`
- `POST /api/v1/processes/:name/npm-build`
- `POST /api/v1/processes/:name/deploy`
- `GET /api/v1/processes/:name/git/commits`
- `POST /api/v1/processes/:name/git/pull`
- `POST /api/v1/processes/:name/rollback`
- `GET /api/v1/processes/:name/logs`
- `POST /api/v1/processes/:name/flush`
- `DELETE /api/v1/processes/:name`

### Alerts

- `GET /api/v1/alerts/channels`
- `POST /api/v1/alerts/channels`
- `DELETE /api/v1/alerts/channels/:id`
- `POST /api/v1/alerts/channels/:id/test`
- `GET /api/v1/alerts/history`
- `DELETE /api/v1/alerts/history`

### PM2 Daemon

- `POST /api/v1/pm2/save`
- `POST /api/v1/pm2/resurrect`
- `POST /api/v1/pm2/kill`
- `GET /api/v1/pm2/info`

### Caddy

- `GET /api/v1/caddy/status`
- `POST /api/v1/caddy/install`
- `POST /api/v1/caddy/proxies`
- `DELETE /api/v1/caddy/proxies/:domain`
- `POST /api/v1/caddy/restart`

### Public

- `GET /health`
- `GET /metrics` with `Authorization: Bearer <METRICS_TOKEN>`

## Security Notes

- Mutating API routes require CSRF token header `x-csrf-token` matching `pm2_csrf` cookie
- Auth uses HttpOnly cookies `pm2_session` and `pm2_refresh` plus refresh flow
- `.env` read and write is restricted to process working directories under the configured app root
- If a process directory is outside the allowed root, dotenv endpoints return `403`

## Testing and Typecheck

```bash
npm run typecheck
npm --prefix server test
npm --prefix client test
```

## Deployment Notes

- In production mode, the server serves `client/dist`
- Set strong values for `PM2_USER`, `PM2_PASS_HASH` or `PM2_PASS`, `JWT_SECRET`, and `METRICS_TOKEN` before exposing the app

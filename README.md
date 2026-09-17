# PM2 Dashboard

Web app for operating PM2-managed services with real-time monitoring, deployment tools, audit history, dotenv editing, and optional Caddy reverse-proxy management.

- Backend: Express + Socket.IO in `server/`
- Frontend: React + Vite + Tailwind in `client/`
- Auth: JWT cookies plus CSRF protection
- Default app URL: `http://<host>:8000`

### v1.0.8 clean reinstall note

The one-tap installer is safe to run after removing the old PM2 process or old project folder. It now prints progress for dependency install, build, PM2 start, backend readiness, HTTPS setup, and final URLs. If a target folder exists but is broken/non-empty, run with `--force-clean` to move the old folder aside before cloning again. The installer also generates production-safe `PM2_USER`, `PM2_PASS_HASH`, `JWT_SECRET`, and `METRICS_TOKEN` automatically so copied `.env.example` placeholders cannot crash the server.

```bash
curl -fsSL https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.sh | bash -s -- --force-clean
```

After install, these commands work from the project root:

```bash
npm run pm2:status
npm run pm2:logs -- --lines 120
curl -i http://localhost:8000/ready
```

## What It Includes

- Process lifecycle controls: start, stop, restart, reload, delete
- Create / duplicate / deploy / rollback workflows
- Live metrics, logs, restart history, deployment history, audit trail
- Alert channel management and notification history
- Process metadata and `.env` editing
- PM2 daemon actions
- JCode extension guidance for coding-agent workflows outside the dashboard shell
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
npm run setup
```

### 3. Create the environment file

```bash
cp .env.example .env
```

Required keys for a manual install:

```env
PM2_USER=your_admin_username
PM2_PASS_HASH=your_bcrypt_password_hash
JWT_SECRET=<at least 32 random characters>
METRICS_TOKEN=<at least 32 random characters>
```

The one-tap installer auto-generates these values. You only need to set them manually when you skip `scripts/onetap.sh`.

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


## JCode Extension

### JCode runtime socket

PM2 Manager runs JCode with its own writable runtime folder by default:

```bash
/tmp/pm2-manager-jcode-runtime-<uid>/jcode.sock
```

That folder is passed to JCode as `XDG_RUNTIME_DIR`, so the web terminal does not depend on `/run/user/<uid>`, which can leave stale sockets when running under PM2 or root. Override it only when needed:

```bash
JCODE_RUNTIME_DIR=/tmp/pm2-manager-jcode-runtime-0
# Optional: use the host XDG runtime dir intentionally
JCODE_USE_XDG_RUNTIME_DIR=1
```


Coding-agent workflows now run through **JCode**. The dashboard no longer ships a separate assistant page or internal chat endpoint.

Use `Extensions` to install JCode. After installation, open the `JCode` tab to start a live browser terminal session, control status, gateway start/stop, pairing, provider command building, and basic checks. PM2 Manager does not store provider API keys; JCode manages provider access through its own login, provider profiles, or environment variables. If a stale Unix socket exists but refuses connections, PM2 Manager removes that stale `jcode.sock`, starts a fresh JCode server, and then attaches the terminal.

## Updating an Existing Install

This is the safe update flow:

### 1. Pull the latest code

```bash
cd ~/pm2-manager
git pull
```

### 2. Install dependencies if package files changed

```bash
npm run setup
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

## Production Readiness

Before exposing the dashboard outside localhost, use the Settings → Production Readiness panel or call:

```bash
curl -i http://localhost:8000/ready
```

For a detailed authenticated check inside the app, open Settings → Production Readiness. For terminal validation before launch, run:

```bash
npm run preflight
```

The server now fails fast when required secrets are missing, placeholder values are still present, or production uses `PM2_PASS` instead of `PM2_PASS_HASH`. For public deployments, use HTTPS through Caddy or another reverse proxy, set `COOKIE_SECURE=1`, and put the exact browser origin in `CORS_ALLOWED_ORIGINS` when the frontend and API are not on the same origin.

Security hardening included by default:

- JWT auth cookies with CSRF protection
- Strict security headers and production CSP
- Redacted structured logs
- No-store API responses
- PM2 operation timeout and queue protection
- `/health` for liveness and `/ready` for readiness
- Authenticated `/api/v1/system/readiness` for detailed config checks
- A `PRODUCTION_CHECKLIST.md` file for deployment review

## Local Development

### 1. Install dependencies

```bash
npm run setup:dev
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
- For one-tap installs, confirm the generated `.env` contains `PM2_PASS_HASH`, `JWT_SECRET`, and `METRICS_TOKEN`. For manual installs, set strong values before exposing the app.

## PM2 Feature Workspace

The dashboard now includes **PM2 Features** at `/dashboard/pm2-features` for commands that do not belong in the daily Overview flow.
See `PM2_FEATURE_COVERAGE.md` for the full command coverage and safety notes.

Covered groups:

- Observe: `status`, `jlist`, `prettylist`, `describe`, `pid`, `env`, `conf`, `report`, `ping`, version.
- Lifecycle: start existing, stop, restart, restart with `--update-env`, reload, graceful reload, reset, delete, scale, send signal, trigger.
- Logs: one-shot log tail, flush, and `reloadLogs`.
- Persistence: save, resurrect, startup, unstartup, update daemon, kill daemon.
- Ecosystem: generate ecosystem files, `startOrRestart`, `startOrReload`, `startOrGracefulReload`.
- Deploy: `pm2 deploy <ecosystem> <environment> <action>`.
- Modules: install/uninstall modules plus `pm2 get` and `pm2 set` for module config.

High-impact actions require an explicit confirmation in the UI and an acknowledgement token in the API request. Long-running interactive PM2 commands such as `pm2 monit` and `pm2 web` are intentionally represented by dashboard monitoring panels or documented as manual operations instead of being launched inside the web request lifecycle.

Additional PM2 endpoints:

- `GET /api/v1/pm2/features`
- `POST /api/v1/pm2/features/run`

### One-tap domain behavior

When a domain is entered during `scripts/onetap.sh`, the installer does **not** claim the root domain.
It exposes PM2 Manager on the public port instead:

```text
https://your-domain.example:8000
```

To avoid port collision, the app listens internally on the next port, normally `127.0.0.1:8001`, and Caddy proxies the public TLS address `https://your-domain.example:8000` to that internal app port. Leave the domain prompt blank to skip the public HTTPS setup.

### Direct dashboard routes

The server serves the built React app for `/`, `/dashboard`, and nested dashboard routes when `client/dist/index.html` exists. API routes remain under `/api` and `/api/v1`.

### Local TypeScript setup

Run `npm run setup` from the repository root after cloning. This installs client and server dependencies without rewriting package-lock files. Use `npm run setup:dev` when you also want root dev-only tools. If npm shows an Arborist/`edgesOut` error, run `npm run repair:npm`.


### JCode extension terminal

The JCode dashboard tab can now start an interactive JCode session inside the browser. Press **Start session** to start or reuse the local JCode server first, then attach with `jcode connect` through the existing authenticated Socket.IO terminal bridge. This avoids the first-run hang where a raw `jcode` client could stop at “Connecting to server...” under PM2/root when the runtime socket directory was missing. The JCode gateway controls remain available for pairing and thin clients, but the main workflow is now terminal-first.

# PM2 Dashboard

Web app for operating PM2-managed services with real-time monitoring, deployment tools, and auditability.

- Backend: Express + Socket.IO (`server/`)
- Frontend: React + Vite + Tailwind (`client/`)
- Auth: JWT cookies (access + refresh) + CSRF token
- Features: process lifecycle controls, create/deploy/rollback, logs, notification channels, restart/deploy/audit history, metadata, `.env` editor, Caddy integration, interpreter detection

Default app URL: `http://<host>:8000`

## Quick Start (One Tap)

NPM (recommended once published):

```bash
npx @anonymoussysna/pm2-manager-cli
```

Linux/macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.sh | bash
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.ps1 | iex"
```

## Current Webapp Modules

- Dashboard: live process status, metrics charts, bulk actions, deploy/rollback, metadata editing, `.env` editing, app URL quick-open (when port is known)
- Create: process creation workflow with live step events
- Logs: per-process logs and log actions
- Notifications: in-app notification history + alert event visibility
- History: deployment history, restart history, audit trail (all paginated)
- Settings: PM2 daemon controls, auth password change, dashboard preferences, config export/import, alert channel management
- Extensions: Caddy install/status and interpreter catalog detection
- Caddy: reverse proxy management (only shown when Caddy is available)

## Project Structure

```text
.
|- server/              # API routes, PM2 control, sockets, stores
|- client/              # React UI
|- logs/                # JSON/JSONL data stores
|- ecosystem.config.js  # PM2 app definition for this dashboard
`- package.json         # root scripts
```

## Requirements

- Node.js 18+ (or 20+ recommended)
- npm
- git

## Install

```bash
npm install
npm --prefix server install
npm --prefix client install
```

## One-Tap Start

Runs clone/pull, dependency install, client build, `.env` bootstrap, and PM2 start/restart.

Linux/macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.sh | bash
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -Command "iwr -useb https://raw.githubusercontent.com/AnonymousSysna/pm2-manager/main/scripts/onetap.ps1 | iex"
```

Optional overrides:

- `REPO_URL=<git-url>` to use a different repository
- `PM2_MANAGER_DIR=<install-path>` to choose target directory

If you are already inside this repo, run:

```bash
npm run onetap:linux
```

```powershell
npm run onetap:windows
```

## Environment Variables

Use root `.env.example` as baseline, then add optional advanced keys as needed.

Required keys:

```env
PM2_USER=replace_with_admin_username
PM2_PASS_HASH=$2a$10$replace_with_bcrypt_hash
JWT_SECRET=replace_with_long_random_secret
METRICS_TOKEN=replace_with_long_random_token
```

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

Advanced optional keys currently supported by the backend:

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
- `AUTH_ALLOWED_IPS` is a comma-separated allowlist for login/API/socket/metrics access.
- `TRUST_PROXY=1` should be set behind reverse proxies (Nginx/Cloudflare).
- `COOKIE_SECURE` can be empty (auto), `true`, or `false`.
- `CORS_ALLOWED_ORIGINS` accepts comma-separated origins.
- For auth, you can use `PM2_PASS` (plain) or `PM2_PASS_HASH`; hashed is recommended.

## Password Hash Setup

```bash
cd server
node -e "const bcrypt=require('bcryptjs'); const p=process.argv[1]; if(!p){process.exit(1);} console.log(bcrypt.hashSync(p,10));" "YourStrongPassword"
```

## Development

```bash
npm run dev
```

Defaults:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health: `http://localhost:8000/health`
- When `VITE_API_URL` is unset, the Vite dev server proxies `/api` and `/socket.io` to `http://localhost:8000`.

## Build and Run

```bash
npm run build
npm run start
```

With PM2:

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

- Mutating API routes require CSRF token header `x-csrf-token` matching `pm2_csrf` cookie.
- Auth uses HttpOnly cookies (`pm2_session`, `pm2_refresh`) plus refresh flow.
- `.env` read/write is restricted to process working directories under app root:
  - if `PROJECTS_ROOT` ends with `apps`, that path is used
  - otherwise allowed root is `PROJECTS_ROOT/apps`
- If a process directory is outside allowed root, dotenv endpoints return `403`.

## Testing and Typecheck

```bash
npm run typecheck
npm --prefix server test
npm --prefix client test
```

## Deployment Notes

- In production mode, server serves `client/dist` and handles SPA fallback routing.
- Set strong values for `PM2_USER`, `PM2_PASS_HASH` (or `PM2_PASS`), `JWT_SECRET`, and `METRICS_TOKEN` before exposing the app.

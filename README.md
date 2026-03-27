# PM2 Dashboard

PM2 process manager web UI with:
- Express API + Socket.io backend
- React + Vite + Tailwind frontend
- Auth with JWT HttpOnly cookie + CSRF protection
- Process lifecycle controls, deploy/rollback, logs, alerts, metadata, and app `.env` editing

Default access target: `http://<host>:8000`

## Project Structure

```text
.
├─ server/              # API, PM2 controller, sockets
├─ client/              # React dashboard
├─ logs/                # history stores (alerts/restarts/deployments/etc.)
├─ ecosystem.config.js  # PM2 app definition for this dashboard
└─ package.json         # root scripts
```

## Requirements

- Node.js 18+ or 20+
- npm
- PM2 installed globally on host (`npm i -g pm2`)

## Environment Variables

Use root `.env.example` as baseline:

```env
# Auth
PM2_USER=replace_with_admin_username
PM2_PASS_HASH=$2a$10$replace_with_bcrypt_hash
JWT_SECRET=replace_with_long_random_secret

# Network / HTTP
PORT=8000
AUTH_ALLOWED_IPS=
TRUST_PROXY=0
COOKIE_SECURE=
CORS_ALLOWED_ORIGINS=http://localhost:5173

# Runtime
PROJECTS_ROOT=/root/pm2-manager/apps/
COMMAND_TIMEOUT_MS=300000
LOG_TAIL_MAX_BYTES=1048576
CADDYFILE_PATH=/etc/caddy/Caddyfile
CADDY_MANAGED_SITES_PATH=./logs/caddy-managed-sites.json

# Restart history
RESTART_HISTORY_PATH=./logs/restart-history.jsonl
RESTART_HISTORY_MAX_LINES=20000
RESTART_HISTORY_MAX_BYTES=10485760

# Deploy history
DEPLOY_HISTORY_PATH=./logs/deploy-history.jsonl
DEPLOY_HISTORY_MAX_LINES=5000
DEPLOY_HISTORY_MAX_BYTES=5242880

# Alerts
ALERT_CHANNELS_PATH=./logs/alert-channels.json
ALERT_TIMEOUT_MS=8000

# Metrics
METRICS_HISTORY_PATH=./logs/metrics-history.json
METRICS_HISTORY_MAX_POINTS=720
METRICS_TOKEN=replace_with_long_random_token
```

Notes:
- `AUTH_ALLOWED_IPS` is a comma-separated allowlist for login/API/socket access.
- Set `TRUST_PROXY=1` behind reverse proxies (Nginx/Cloudflare).
- `CORS_ALLOWED_ORIGINS` accepts comma-separated origins.
- `COOKIE_SECURE` can be empty (auto), `true`, or `false`.
- Server local file `server/.env` is scaffolded for local development.

## Password Hash Setup

Generate bcrypt hash for `PM2_PASS_HASH`:

```bash
cd server
node -e "const bcrypt=require('bcryptjs'); const p=process.argv[1]; if(!p){process.exit(1);} console.log(bcrypt.hashSync(p,10));" "YourStrongPassword"
```

## Install

```bash
npm install
npm --prefix server install
npm --prefix client install
```

## Development

```bash
npm run dev
```

Defaults:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health: `http://localhost:8000/health`

## Production

Build frontend:

```bash
npm run build
```

Run directly:

```bash
npm run start
```

Run with PM2:

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
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

### Processes
- `GET /api/v1/processes`
- `GET /api/v1/processes/catalog`
- `GET /api/v1/processes/monitoring/summary`
- `GET /api/v1/processes/history/restarts?limit=200`
- `GET /api/v1/processes/history/deployments?limit=100&process=<name>`
- `GET /api/v1/processes/:name`
- `GET /api/v1/processes/:name/metrics?limit=120`
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
- `GET /api/v1/processes/:name/git/commits?limit=20`
- `POST /api/v1/processes/:name/rollback`
- `DELETE /api/v1/processes/:name`
- `GET /api/v1/processes/:name/logs?lines=100`
- `POST /api/v1/processes/:name/flush`
- `GET /api/v1/processes/config/export`
- `POST /api/v1/processes/config/import`

### Alerts
- `GET /api/v1/alerts/channels`
- `POST /api/v1/alerts/channels`
- `DELETE /api/v1/alerts/channels/:id`
- `POST /api/v1/alerts/channels/:id/test`
- `GET /api/v1/alerts/history?limit=200`
- `DELETE /api/v1/alerts/history`

### PM2 Daemon
- `POST /api/v1/pm2/save`
- `POST /api/v1/pm2/resurrect`
- `POST /api/v1/pm2/kill`
- `GET /api/v1/pm2/info`

### Caddy / Extensions
- `GET /api/v1/caddy/status`
- `POST /api/v1/caddy/install`
- `POST /api/v1/caddy/proxies`
- `POST /api/v1/caddy/restart`

### Public
- `GET /health`
- `GET /metrics` (`Authorization: Bearer <METRICS_TOKEN>`)

## Important Security Notes

- All mutating API routes require CSRF token (`x-csrf-token`) matching `pm2_csrf` cookie.
- `.env` editing endpoint is restricted to process working directories inside app root:
  - allowed root is `PROJECTS_ROOT/apps`
  - if `PROJECTS_ROOT` already ends with `apps`, that path is used directly
- If process directory is outside allowed app root, dotenv endpoints return `403`.

## Current Dashboard Behavior

- Create process shows blocking launch overlay while backend work runs (clone/install/build/start).
- On successful create, UI redirects to process logs page.
- Dashboard action buttons use consistent outlined action style.
- `Edit .env` is shown only when a process has `.env` inside allowed app root.
- `Open App` quick action is available from Dashboard process actions when process port is detected.

## Deployment Notes

- In production, `server/index.js` serves `client/dist` and handles SPA routing.
- Set strong values for `PM2_USER`, `PM2_PASS_HASH`, `JWT_SECRET`, and `METRICS_TOKEN` before deployment.

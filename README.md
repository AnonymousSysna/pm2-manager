# PM2 Dashboard

Web dashboard for managing PM2 processes with:
- Node.js + Express backend
- React + Vite + Tailwind frontend
- Socket.io real-time process updates/log stream
- JWT-backed HttpOnly cookie authentication

Access target: `http://YOUR_VPS_IP:8000`

## Project Structure

```text
.
├─ server/              # Express API + PM2 controller + Socket.io
├─ client/              # React dashboard (Vite + Tailwind)
├─ logs/                # PM2 app logs
├─ ecosystem.config.js  # PM2 app definition
└─ package.json         # Root scripts
```

## Requirements

- Node.js 18+ or 20+
- npm
- PM2 installed (`npm i -g pm2`) on the host where you deploy

## Environment Variables

Root `.env.example`:

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

`AUTH_ALLOWED_IPS` supports a comma-separated allowlist of client IPs.
If set, only those IPs can log in or use authenticated API/socket endpoints.
Use `TRUST_PROXY=1` when running behind Nginx/Cloudflare so real client IP is detected.
`CORS_ALLOWED_ORIGINS` is a comma-separated list of allowed browser origins.
`COOKIE_SECURE` is optional: leave empty for auto-detect from request protocol, or set `true`/`false` to force.

Server local dev file (`server/.env`) is already scaffolded.

## New User: Create `bcrypt_hash` For Password

Use this when setting `PM2_PASS_HASH`.

1. Install dependencies (if not done yet):

```bash
npm install
npm --prefix server install
```

2. Generate a bcrypt hash (replace `YourStrongPasswordHere`):

```bash
cd server
node -e "const bcrypt=require('bcryptjs'); const p=process.argv[1]; if(!p){console.error('Usage: node -e \"...\" <password>'); process.exit(1);} console.log(bcrypt.hashSync(p, 10));" "YourStrongPasswordHere"
```

3. Copy the output (starts with `$2a$10$...`), then set it in `.env`:

```env
PM2_PASS_HASH=$2a$10$replace_with_generated_hash
```

4. Optional check (compare plain password vs hash):

```bash
node -e "const bcrypt=require('bcryptjs'); const p=process.argv[1]; const h=process.argv[2]; console.log(bcrypt.compareSync(p,h)?'MATCH':'NO_MATCH');" "YourStrongPasswordHere" "$2a$10$replace_with_generated_hash"
```

Do not store the plain password in `.env`; only store the hash.

## Install

From repo root:

```bash
npm install
npm --prefix server install
npm --prefix client install
```

## Development

Run backend + frontend together:

```bash
npm run dev
```

Default URLs:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- Health: `http://localhost:8000/health`

## Production Build + Run

Build frontend:

```bash
npm run build
```

Run with Node directly:

```bash
npm run start
```

Run with PM2:

```bash
npm run pm2:start
npm run pm2:logs
```

Useful PM2 scripts:

```bash
npm run pm2:restart
npm run pm2:stop
npm run pm2:save
```

One-command deploy flow:

```bash
npm run deploy
```

## API Overview

Versioned base path:
- `v1`: `/api/v1/...`
- compatibility alias: `/api/...`

Auth:
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/change-password`

CSRF:
- Mutating routes require `x-csrf-token` matching `pm2_csrf` cookie (double-submit cookie pattern).

Processes:
- `GET /api/v1/processes`
- `GET /api/v1/processes/catalog` (live processes + tags/dependencies metadata)
- `GET /api/v1/processes/monitoring/summary` (uptime/downtime + restart anomaly summary)
- `GET /api/v1/processes/history/restarts?limit=200`
- `GET /api/v1/processes/history/deployments?limit=100&process=<name>`
- `GET /api/v1/processes/:name`
- `GET /api/v1/processes/:name/metrics?limit=120`
- `PATCH /api/v1/processes/:name/meta` (group/tags/dependencies/alert thresholds)
- `DELETE /api/v1/processes/:name/meta`
- `POST /api/v1/processes/create`
- `POST /api/v1/processes/bulk-action` (batch `start` / `stop` / `restart`)
- `POST /api/v1/processes/:name/start`
- `POST /api/v1/processes/:name/stop`
- `POST /api/v1/processes/:name/restart`
- `POST /api/v1/processes/:name/reload`
- `PATCH /api/v1/processes/:name/env` (inline env update + restart with `updateEnv`)
- `POST /api/v1/processes/:name/deploy` (git pull + optional npm install/build + restart/reload)
- `POST /api/v1/processes/:name/npm-install`
- `POST /api/v1/processes/:name/npm-build`
- `DELETE /api/v1/processes/:name`
- `GET /api/v1/processes/:name/logs?lines=100`
- `POST /api/v1/processes/:name/flush`
- `GET /api/v1/processes/config/export`
- `POST /api/v1/processes/config/import`

Alerts:
- `GET /api/v1/alerts/channels`
- `POST /api/v1/alerts/channels`
- `DELETE /api/v1/alerts/channels/:id`
- `POST /api/v1/alerts/channels/:id/test`

PM2 daemon:
- `POST /api/v1/pm2/save`
- `POST /api/v1/pm2/resurrect`
- `POST /api/v1/pm2/kill`
- `GET /api/v1/pm2/info`

Public:
- `GET /health`
- `GET /metrics` (`Authorization: Bearer <METRICS_TOKEN>` required)

## Notes

- In production, `server/index.js` serves `client/dist` and handles SPA routing.
- Set strong values for `PM2_USER`, `PM2_PASS_HASH`, `JWT_SECRET`, and `METRICS_TOKEN` before deploying.
- New dashboard features include: bulk actions (select multiple processes and start/stop/restart at once), process templates for reusable create configs, inline environment variable editing for running processes, Git Clone create mode (clone from URL with optional `.env` write + optional npm install/build before start), process tags/dependencies, metrics history charts, threshold alerts, restart anomaly flags, combined searchable logs with TXT/CSV export, theme toggle, keyboard shortcuts, process config import/export, one-click deploy, deployment history, and external alert channels (webhook/Slack webhook).

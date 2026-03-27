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

- Node.js 18+
- npm
- PM2 installed (`npm i -g pm2`) on the host where you deploy

## Environment Variables

Root `.env.example`:

```env
PM2_USER=replace_with_admin_username
PM2_PASS_HASH=$2a$10$replace_with_bcrypt_hash
JWT_SECRET=replace_with_long_random_secret
PORT=8000
AUTH_ALLOWED_IPS=203.0.113.10
TRUST_PROXY=1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
PROJECTS_ROOT=D:/apps
COMMAND_TIMEOUT_MS=300000
LOG_TAIL_MAX_BYTES=1048576
RESTART_HISTORY_PATH=./logs/restart-history.jsonl
RESTART_HISTORY_MAX_LINES=20000
RESTART_HISTORY_MAX_BYTES=10485760
METRICS_TOKEN=replace_with_long_random_token
```

`AUTH_ALLOWED_IPS` supports a comma-separated allowlist of client IPs.
If set, only those IPs can log in or use authenticated API/socket endpoints.
Use `TRUST_PROXY=1` when running behind Nginx/Cloudflare so real client IP is detected.
`CORS_ALLOWED_ORIGINS` is a comma-separated list of allowed browser origins.

Server local dev file (`server/.env`) is already scaffolded.

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
- `GET /api/v1/processes/history/restarts?limit=200`
- `GET /api/v1/processes/:name`
- `POST /api/v1/processes/create`
- `POST /api/v1/processes/:name/start`
- `POST /api/v1/processes/:name/stop`
- `POST /api/v1/processes/:name/restart`
- `POST /api/v1/processes/:name/reload`
- `DELETE /api/v1/processes/:name`
- `GET /api/v1/processes/:name/logs?lines=100`
- `POST /api/v1/processes/:name/flush`

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

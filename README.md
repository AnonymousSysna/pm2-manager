# PM2 Dashboard

Web dashboard for managing PM2 processes with:
- Node.js + Express backend
- React + Vite + Tailwind frontend
- Socket.io real-time process updates/log stream
- JWT authentication

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
PM2_USER=admin
PM2_PASS=changeme
JWT_SECRET=your-secret-key-here
PORT=8000
AUTH_ALLOWED_IPS=203.0.113.10
TRUST_PROXY=1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
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

Auth:
- `POST /api/auth/login`
- `POST /api/auth/change-password`

Processes:
- `GET /api/processes`
- `GET /api/processes/:name`
- `POST /api/processes/create`
- `POST /api/processes/:name/start`
- `POST /api/processes/:name/stop`
- `POST /api/processes/:name/restart`
- `POST /api/processes/:name/reload`
- `DELETE /api/processes/:name`
- `GET /api/processes/:name/logs?lines=100`
- `POST /api/processes/:name/flush`

PM2 daemon:
- `POST /api/pm2/save`
- `POST /api/pm2/resurrect`
- `POST /api/pm2/kill`
- `GET /api/pm2/info`

Public:
- `GET /health`

## Notes

- In production, `server/index.js` serves `client/dist` and handles SPA routing.
- Set strong values for `PM2_PASS` and `JWT_SECRET` before deploying.

# Production Checklist

Use this before exposing PM2 Manager outside localhost.

## Required

- For one-tap installs, confirm the installer generated `.env` secrets automatically.
- For manual installs, replace every placeholder in `.env`.
- Keep `.env` out of version control. It is gitignored now; verify with
  `git check-ignore -v .env` before your first commit.
- Use `PM2_PASS_HASH`, not `PM2_PASS`, in production.
  - Changing the password in the UI rewrites `PM2_PASS_HASH` in `.env` on disk.
- Use a `JWT_SECRET` with at least 32 random characters.
- Use a `METRICS_TOKEN` with at least 32 random characters.
- Run `npm run build` before starting PM2 in production.
- Run `npm run preflight` and fix every failed item.
- Confirm `/ready` returns HTTP 200 after PM2 starts the dashboard.

## Environment separation

Configuration resolves most-specific-first, and real process env always wins over
any file:

1. shell / PM2 / systemd environment
2. `server/.env.<NODE_ENV>` (for example `server/.env.staging`)
3. `.env.<NODE_ENV>`
4. `server/.env`
5. `.env`

`NODE_ENV` comes from the runtime, or from `.env` when it is unset. Supported
names are `development`, `test`, `staging`, and `production`. Client builds read
`client/.env.<mode>` (see `client/.env.example`); never put secrets there,
because everything in those files ships to the browser.

## Recommended

- Put the dashboard behind HTTPS.
- Set `TRUST_PROXY=1` when running behind Caddy, Nginx, Cloudflare, or another reverse proxy.
- Set `COOKIE_SECURE=1` when HTTPS is always used.
- Set `CORS_ALLOWED_ORIGINS` to the exact browser origin if the API and frontend use different origins.
- Restrict `AUTH_ALLOWED_IPS` when possible.
- Configure at least one alert channel before relying on the dashboard for production monitoring.
- Run `npm run verify` before deploying changes when dependencies are installed.

## Accessibility

- `npm run check:contrast` audits every text/background pair from the design
  tokens in `client/src/index.css` for both themes. It is part of `npm run
  verify`, so a token change that lowers small-text contrast below WCAG AA
  fails the check instead of shipping.
- Tokens ending in `-300` are the only sanctioned text colors for status
  messages; `-500` and `-600` are for borders, fills, and solid button
  backgrounds. Mixing them up is what makes status text unreadable in one theme.

## Operational safety

- Use the dashboard triage order: attention first, then logs, then action.
- Prefer restart/reload before stop/kill.
- Use delete only after exporting process config or confirming the process can be recreated.

## PM2 Feature Workspace

- Review who can log in before enabling public access; PM2 Features exposes high-impact operational commands.
- Keep `PROJECTS_ROOT` tight so ecosystem and deploy commands cannot point at unexpected paths.
- Treat module install/uninstall as code execution. Use it only for trusted PM2 modules such as `pm2-logrotate`.
- Use `pm2 save` after intentional process changes that should survive reboot.
- Prefer the Overview page for daily operations; use PM2 Features for advanced recovery/configuration work.

## JCode extension

- Keep provider API keys out of PM2 Manager and configure them in JCode directly.
- Use `jcode login` or `jcode provider add --api-key-env` instead of browser-stored secrets.
- Use the JCode tab for install/status/gateway control and live JCode coding-agent sessions. The terminal sends raw browser keys into a server PTY; protect dashboard access like root shell access when PM2 Manager runs as root.

## Installer readiness

- Confirm `npm run pm2:status` shows `pm2-dashboard` online.
- Confirm `curl -i http://localhost:8000/ready` returns a non-5xx response.
- Confirm final installer summary prints the local URL, public URL, HTTPS status, generated credentials, and log commands.
- Rotate generated credentials after pasting them into chat, tickets, logs, or screenshots.

## Domain / HTTPS installer behavior

- Entering a domain in the one-tap installer keeps the root domain untouched.
- The public dashboard URL uses the public port, for example `https://your-domain.example:8000`.
- The backend listens on an internal local port, normally `8001`, so Caddy can own public port `8000` for HTTPS.
- Open the selected public port in the VPS firewall/security group.
- Use a subdomain instead if you want standard HTTPS on port `443` without showing a port in the URL.

- JCode browser terminal: install JCode first, then verify `/dashboard/jcode` starts the selected command (`jcode`, a login command, auth test, or allowed custom command), accepts direct typing, paste, arrows, Ctrl+C/Ctrl+D, and stops cleanly on disconnect. The launcher should use PM2 Manager's writable `/tmp/pm2-manager-jcode-runtime-<uid>` runtime by default, remove stale sockets there, and avoid relying on `/run/user/<uid>` unless `JCODE_USE_XDG_RUNTIME_DIR=1` is explicitly set.


### JCode terminal runtime note

The JCode web terminal starts the selected command inside a PTY with `JCODE_RUNTIME_DIR` and `XDG_RUNTIME_DIR` pointed at PM2 Manager's owned runtime folder. The default command is `jcode`, so JCode can bootstrap its own daemon naturally. Custom non-`jcode` commands are allowed only for root installs or when `JCODE_ALLOW_CUSTOM_TERMINAL=1` is deliberately set.

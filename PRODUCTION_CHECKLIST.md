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

## API error contract

- Controllers return `{ success, data, error }` envelopes; failures built with
  `server/utils/serviceResult.ts` also carry `status` and `code`. Routes answer with
  `res.status(resultStatus(result))` and nothing else.
- Never pick a status by pattern-matching `result.error`. `ValidationError` (400),
  `ConflictError` (409), `ForbiddenError` (403), `NotFoundError` (404), and
  `UnavailableError` (503) exist so the failure itself states its meaning; reword
  the message freely without changing the response code.
- The client renders the server's `error` string for any status, so a status code
  drives retry and copy behavior, not whether the user sees the message.
- Installer routes no longer guess: an install or environment failure reports 500
  rather than the old 400. Move the classification into the installer module (for
  example `UnavailableError` when a version manager is missing) if a 4xx is needed.

## Validation

- `server/utils/validation.ts` owns the field rules. The browser mirror in
  `client/src/lib/validation.ts` is checked against it, so `npm --prefix client
  test` fails when a pattern, reserved name, protocol list, or length limit drifts.
- `server/tests/fixtures/validationCases.json` holds accept/reject cases that both
  suites run, so a rule only one side implements fails a build.
- Forms validate before submitting: process names, script paths, environment
  variable names, memory limits, git clone URLs, and cron schedules report the
  problem inline instead of costing a round trip and a 400 response.
- Cron values allow up to six fields of `[A-Za-z0-9_*,?/-]` separated by single
  spaces. Tabs, newlines, and shell metacharacters are rejected before the value
  reaches PM2's scheduler.

## Connection and freshness states

- The shell badge and status strip come from one derived state in
  `client/src/hooks/connectionState.ts`: `Live`, `Reconnecting`, or `Offline`. The
  decision is pure, so it is tested without a socket or a clock
  (`client/src/hooks/connectionState.test.ts`).
- A browser with no network is reported as offline with "changes cannot be
  saved", which is different from a reachable browser that cannot reach the
  server ("actions are still sent"). Collapsing both into "Offline" made users
  retry saves that could not possibly succeed.
- Once the visible process data is older than 10s while the socket is down, the
  strip appends "Showing data from 4m ago", so stale numbers are never mistaken
  for live ones. The age only re-derives on a 5s timer while the connection is
  unhealthy, so a healthy session does not re-render for a clock tick.
- Copy comes from the shared `Banner` and `Badge` primitives, so the shell and
  any page surface cannot disagree about what a status means.
## Failed reads versus empty data

- A read that fails never renders as empty data. `client/src/components/DataLoadError.tsx`
  shows the failure where the data should have been, with the retry action next
  to it, and hides the surface's empty-state copy.
- Messages come from `client/src/lib/apiError.ts`, the same source the request
  layer uses, so an offline browser, a timeout, a 503, and an expired session read
  the same way in a toast and on a panel.
- Covered surfaces: the three History sections, the alert channel list in
  Settings, the dashboard Resource Trends chart, process-detail telemetry, and
  the log stream. A rejected response envelope (`success: false`) is treated as a
  failure too, not just a thrown request error.
- The log stream no longer uses "Waiting." for both "nothing written yet" and
  "the read failed", and it keeps the last rendered lines when a poll fails. The
  process detail modal also keeps its last sample and reports the failed refresh,
  because it polls every 10s and one dropped poll should not blank the panel.
- Background polling that is genuinely best-effort (system resources, onboarding
  checklist, process list for filters) still fails quietly, and says so in a
  comment, so a silent catch is a decision rather than an oversight.


## Design system contracts

- Meta labels (the small uppercase label above a value) come from `Eyebrow` /
  `.meta-label`. The raw `text-[11px]` and `tracking-[0.16em]` utilities are
  defined once in `client/src/index.css`; `client/src/design-system.test.tsx`
  fails if they reappear in a component. Long machine text, such as a stack
  trace, uses `.stack-trace`.
- Shared primitives carry a stable class hook (`banner`, `page-heading`,
  `panel-heading`, `meta-label`) so a contract test can assert the component's
  role instead of an incidental utility such as a corner radius.
- Primitive props are declared, not inferred. `PolymorphicProps` in
  `components/ui/polymorphic.ts` types the `as`-polymorphic primitives, so a
  misspelled or missing prop is a compile error instead of a silently
  ignored attribute. This is what caught `<Field>` being typed as requiring
  `htmlFor` and `description` from every one of its 36 call sites.
- A prop a component accepts must be honoured. `Modal` accepts
  `description`; it now renders it and points `aria-describedby` at it.
  `Field` never honoured `description`, so the prop is gone rather than
  declared and dropped.
- Tests assert the copy users actually see. When a label changes on purpose the
  assertion moves with it in the same change, so the suite keeps catching
  regressions instead of drifting out of date.

## Overview cognitive load

- The overview is the busiest screen and has a budget:
  `client/src/pages/Dashboard.cognitiveLoad.test.tsx` renders it against a
  fixed three-process, six-alert fixture and fails when the panel, section,
  control, or text counts climb past it. The budget is the reduced state
  (6 panels, 7 sections, 30 controls, 982 characters), not an aspiration, so
  page growth is a deliberate edit to the numbers.
- One dataset gets one surface. Alerts used to render twice on the overview:
  once in the triage attention queue and again in a separate 20-row alert feed
  with the same process, metric, threshold, timestamp and open-logs button.
  The queue absorbed the feed's `message` text and the feed panel is gone.
- A repeated control label is a finding. The triage panel used to show
  "History" eight times on one screen: in the page header, in the panel
  header, on two of the four status cards, and on every queue row. All eight
  went to the same unfiltered view. Global destinations now have one entry
  point per screen, the status cards are read-only, and the row links are
  scoped to the process the row is about.

## Type checking

- `npm run typecheck` is expected to be clean for both projects, and is the
  gate for every change. Both backlogs are cleared (server 190 -> 0, client
  176 -> 0), so a new error is a regression rather than noise.
- `npm --prefix client run typecheck:test` additionally type-checks the test
  files, which the default client config excludes.
- Client types are load-bearing in two places: the design-system props
  (`components/ui`) and the live data layer (`sync/`). Both were untyped or
  inferred before, which is how a dropped prop or a malformed socket payload
  went unnoticed.
- Server helpers annotate what they return instead of leaving `new Promise(...)`
  to infer `unknown`: PM2 process descriptions, command results, alert
  channels, health checks, and process metadata each have a named interface.
  That is what makes a typo such as `proc.pm2_env.portt` fail the build.
- Module boundaries that are crossed with `require()` are typed structurally at
  the use site, because `require` itself gives no type information.

## Live data layer

- The live process list is served by `client/src/sync/DataSyncService`, which
  owns the state, the poll fallback, and the reconnect flags. The transport is
  injected, so changing how updates arrive does not touch the UI:
  - `sync/socketTransport.ts` is the socket.io adapter (the only file that
    knows event names).
  - `sync/processStore.ts` holds the pure merge and buffer-cap rules.
  - `hooks/useSocket.ts` is the React binding and nothing else.
- Server payloads are treated as untrusted JSON. A malformed snapshot, delta,
  or log line is dropped rather than blanking the list or the log view.
- Buffers are capped (1000 log lines per process, 200 alerts, 400
  notifications, 200 create steps) so a long-lived tab cannot grow without
  bound.
- The fallback poll runs at 3x the configured push interval, clamped to 5-15s,
  and is a safety net only; the socket remains the primary source.

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

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
  declared and dropped, and `PageLayout`'s `PageIntro` and `PanelHeader`
  have lost the `description` they accepted and discarded.
- `props-honoured.test.ts` walks every primitive in that folder and fails
  when a destructured prop name never appears again in its own file. That is
  the check that would have caught `description: _description` on the day it
  was written, in all three components that had it.

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

## Critical path payload

- `npm run check:bundle` builds the client and measures every chunk the browser
  must fetch before the first paint: the scripts `dist/index.html` references
  plus everything they reach with a static import. It fails above 120 kB gzip,
  and fails when a reachable chunk carries a dependency that has to stay
  deferred (the toast stack, which vendors sonner and motion).
- The measured total is 100.3 kB gzip, down from 157.2 kB. The budget leaves room
  for features and none for the 57 kB regression, which is otherwise invisible in
  review: one static `import "goey-toast"` puts it all back.
- Dynamic imports are deliberately not counted, because they are a fetch on
  demand. `goey-toast` is 60 kB gzip and no longer eager, so
  `client/src/lib/toast.ts` queues any call made while it is still arriving and
  replays it once loaded. `goey-toast/styles.css` stays a static import, since
  the toaster renders before the module resolves and must not flash unstyled.
- The rule for a heavy dependency: it is on the critical path only if the first
  paint needs it. A toast cannot appear before the user does something.

## Accessibility

- Every control on a rendered page has an accessible name.
  `client/src/test/accessibleName.ts` defines what counts (`aria-label`,
  `aria-labelledby`, a real `<label>`, or visible content for buttons and
  links; a placeholder or a title is not a name) and
  `client/src/pages/pages.accessibleNames.test.tsx` renders seven pages, each
  with a control floor so a page that stopped rendering cannot pass vacuously.
- Names describe the target, not the widget: "More actions for api-server" and
  "Select api-server", not "More" and "Select". A screen reader listing the
  controls on the overview would otherwise read a column of identical labels.
- `npm run check:contrast` audits every text/background pair from the design
  tokens in `client/src/index.css` for both themes. It is part of `npm run
  verify`, so a token change that lowers small-text contrast below WCAG AA
  fails the check instead of shipping.
- Tokens ending in `-300` are the only sanctioned text colors for status
  messages; `-500` and `-600` are for borders, fills, and solid button
  backgrounds. Mixing them up is what makes status text unreadable in one theme.

## Restarts and shutdown

- `server/utils/gracefulShutdown.ts` owns the sequence: disconnect socket
  clients, `server.close()`, close idle keep-alive sockets, close still-busy ones
  after 4s, then exit 0 on a clean close or 1 if the close failed or 10s elapsed.
  A second signal (the operator pressing Ctrl+C twice, or PM2 escalating) exits 1
  immediately instead of starting another drain.
- The order is the whole point. `server.close()` waits for every open connection
  to end on its own, and a dashboard tab holds a websocket open, so closing only
  the HTTP listener never finished: measured against a real socket.io server,
  with no client it closed in 1ms, and with one websocket open it was still
  waiting at 8s until the force timeout ended the restart with exit 1. It now
  completes in ~1ms, logging `server_shutdown_started`, `server_sockets_closed`,
  `server_shutdown_complete`, and no `server_shutdown_forced`.
- `server/tests/gracefulShutdown.test.ts` covers the clean close, a failing and a
  throwing close, the drain-then-force timers, signal escalation, and a server
  without the optional connection helpers.
- An unhandled rejection is logged and the process keeps serving; an uncaught
  exception drains and exits, because the request that threw has left the process
  in an unknown state. `npm run preflight` refuses to start without `PM2_USER`,
  `PM2_PASS_HASH`, `JWT_SECRET`, and `METRICS_TOKEN`.

## Health endpoints

- `/health` and `/ready` both run the same PM2 probe and must always answer. On
  Windows the npm shim is a `.cmd` file, and `spawn("npm.cmd", ...)` throws
  `EINVAL` synchronously on Node 20.12+ instead of emitting an `error` event, so a
  probe awaiter that only listened for the event never settled: measured against a
  real production boot, `GET /ready` and `GET /health` never responded (client gave
  up at 12s) and the process logged an unhandled rejection. They now answer 200 in
  ~1.3s, including `pm2Connected: true`.
- Two rules make that hold: the probe is wrapped in a guard so a throwing probe
  becomes a 503 `not_ready`/`degraded` answer rather than a hanging request, and
  `server/utils/commandSpawn.ts` is the single place that knows how to launch a
  command. On Windows a `.cmd`/`.bat` launches through
  `cmd.exe /d /s /c "<command line>"` with no `shell: true` (so no DEP0190 warning
  and no shell-interpolated user input). Every child process in the server goes
  through that rule: the pm2 routes, the process controller, the interpreter and
  Node runtime installers, the caddy manager, the JCode manager, and the health
  probe. The one exception is the JCode terminal's `node-pty` path, which launches
  a shim itself.
- A shell launch is a process tree, so timeouts end the tree with
  `taskkill /pid <pid> /t /f`; `child.kill()` alone left a wedged `pm2 jlist`
  behind.
- `server/routes/health.ts` keeps both payloads byte-identical to the previous
  inline handlers (plus `pm2Queue` on `/health`), and
  `server/tests/{commandSpawn,healthProbe,healthRoutes}.test.ts` cover the shell
  wrapping and quoting, a missing binary that still settles, the timeout tree kill,
  and both 200 and 503 responses.

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

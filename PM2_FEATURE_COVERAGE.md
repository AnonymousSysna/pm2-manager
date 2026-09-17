# PM2 Feature Coverage

The dashboard now has two PM2 layers:

1. **Daily workflow layer**: Overview, Logs, History, Settings, Add Process, Alerts, Caddy.
2. **Advanced PM2 layer**: PM2 Features at `/dashboard/pm2-features`.

The advanced page is intentionally a guarded command bridge, not a raw terminal. Every action is selected from an allowlist, receives validated arguments, and routes through the same authenticated API, CSRF protection, command timeout, output redaction, and PM2 queue used by the rest of the dashboard.

## Covered in PM2 Features

| Group | PM2 capabilities |
| --- | --- |
| Observe | `status`, `jlist`, `prettylist`, `describe`, `pid`, `env`, `conf`, `report`, `ping`, `-v` |
| Lifecycle | `start`, `stop`, `restart`, `restart --update-env`, `reload`, `gracefulReload`, `reset`, `delete`, `scale`, `sendSignal`, `trigger` |
| Logs | `logs --nostream`, `flush`, `reloadLogs` |
| Persistence | `save`, `resurrect`, `startup`, `unstartup`, `update`, `kill` |
| Ecosystem | `ecosystem`, `ecosystem simple`, `startOrRestart`, `startOrReload`, `startOrGracefulReload` |
| Deploy | `deploy <ecosystem> <environment> <setup/update/revert/exec/list>` |
| Modules | `install`, `uninstall`, `get`, `set` |

## Covered by existing dashboard screens

| PM2 area | Dashboard surface |
| --- | --- |
| New process creation | Add Process handles script, cwd, interpreter, env, args, node args, instances, exec mode, watch, cron restart, memory restart, git clone, npm install/build, and health validation. |
| Live monitoring | Overview, metric history, threshold alerts, dependency graph, system resources, and socket updates. |
| Streaming logs | Logs page. PM2 Features only exposes one-shot log tails to avoid long web requests. |
| Startup persistence | Settings provides a friendlier startup/save flow; PM2 Features exposes the raw advanced commands. |
| Deployment safety | Overview's Deploy modal is still the safer app-level flow; PM2 Features exposes raw `pm2 deploy` for ecosystem-based workflows. |

## Not one-click by design

| PM2 command | Reason |
| --- | --- |
| `pm2 monit` | Interactive terminal UI; use dashboard monitoring instead. |
| `pm2 web` | Starts a separate long-running API service; keep this dashboard as the authenticated web layer. |
| Raw arbitrary PM2 command | Not exposed because it becomes remote shell execution. Add new allowlisted actions instead. |

## Safety behavior

- Critical actions require confirmation in the UI and an acknowledgement token in the API body.
- Process selectors reject whitespace, shell characters, and leading `-` flags.
- Ecosystem/deploy file paths must stay inside the dashboard project or `PROJECTS_ROOT`.
- Command output is truncated and passed through secret redaction before returning to the browser.
- The endpoint uses the PM2 CLI through `npm --prefix server exec pm2 -- ...`, so it uses the server-installed PM2 version.

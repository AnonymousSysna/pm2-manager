# AI Operator Security Model

The AI Operator is intentionally not a raw web terminal. It is a guided assistant that can chat with an AI provider and map plain-language requests to the dashboard's existing PM2 action allowlist.

## Provider setup

Operators can choose:

- OpenAI-compatible API format
- Anthropic Messages API format

The UI accepts provider URL, model id, and API key. Keys are sent to the PM2 Manager backend only for the current request. The backend does not save provider keys. The browser can optionally remember a key in local storage, but that should only be used on a trusted machine.

## Execution modes

- **Plan only**: the AI answers and prepares actions, but does not run them.
- **Auto-run checks only**: read and sensitive-read PM2 checks can run automatically.
- **Auto-run checks + safe writes**: read checks and non-critical write actions can run automatically.

Critical actions such as deleting processes, killing the PM2 daemon, resurrecting saved state, startup changes, unstartup changes, and send-signal actions are never auto-executed. They require a separate confirmation.

## Guardrails

The AI cannot submit arbitrary shell commands. It can only propose action ids from `server/utils/pm2FeatureCatalog.ts`. Each proposed action is validated by the same PM2 feature guard used by the manual PM2 Features page.

Other protections:

- AI request rate limiting
- HTTPS requirement for provider URLs in production unless `AI_ALLOW_HTTP=1`
- API key redaction from logs
- PM2 command output redaction
- Output truncation
- Max planned actions per AI turn
- Critical action confirmation

## Recommended production setup

- Use HTTPS for the dashboard and provider URL.
- Keep `AI_ALLOW_HTTP=0` unless using a trusted local gateway.
- Restrict `AUTH_ALLOWED_IPS` when the dashboard is public.
- Use short-lived provider keys or provider-side spending limits where available.
- Do not enable "Remember key" on shared machines.

## Support-agent diagnostics

The AI Operator now gathers a bounded diagnostics snapshot before each chat request: PM2 status, dashboard PM2 logs, Git status, production env-key presence, and frontend build/static asset state. Secret values are never sent to the AI provider; only presence/absence and redacted command output are included.

The local support layer can prepare guarded repair actions such as env bootstrap, dependency repair, build, and dashboard restart. These actions still pass through the same risk-mode gates: Plan only prepares actions, Auto checks runs read-only diagnostics, and Safe writes can run non-critical repairs.

## Worker loop

The AI Operator now has an explicit worker path for real support tasks. When the operator clicks **Auto repair** or asks the AI to fix a deployment/runtime error, the backend collects evidence, builds an action plan, runs only allowed safe actions for the selected mode, then collects a final snapshot and returns what changed.

The built-in `auto-repair` action can run a bounded sequence based on detected evidence:

1. restore generated production env values when they are missing,
2. repair/install dependencies only when dependency errors are detected,
3. rebuild the dashboard UI when static assets or SPA fallback are broken,
4. restart the dashboard after safe repairs.

It does not run raw shell commands, destructive PM2 actions, or critical daemon changes. Those still require explicit confirmation through the existing action guard.

const { spawn } = require("child_process");
const path = require("path");
const { redactSecretsFromText } = require("./urlSafety");
const {
  getPm2FeatureCatalog,
  buildPm2FeatureInvocation,
  requiresCriticalAcknowledgement
} = require("./pm2FeatureCatalog");
const { trackPm2Operation } = require("../middleware/metrics");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const COMMAND_TIMEOUT_MS = Number.isFinite(Number(process.env.COMMAND_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.COMMAND_TIMEOUT_MS)))
  : 5 * 60 * 1000;
const AI_ACTION_OUTPUT_LIMIT = Number.isFinite(Number(process.env.AI_ACTION_OUTPUT_LIMIT))
  ? Math.max(1000, Math.floor(Number(process.env.AI_ACTION_OUTPUT_LIMIT)))
  : 6000;
const AI_MAX_ACTIONS = Number.isFinite(Number(process.env.AI_MAX_ACTIONS))
  ? Math.min(10, Math.max(1, Math.floor(Number(process.env.AI_MAX_ACTIONS))))
  : 6;

const fs = require("fs");
const os = require("os");

const DASHBOARD_PROCESS_NAME = String(process.env.PM2_MANAGER_PROCESS_NAME || process.env.PM2_APP_NAME || "pm2-dashboard").trim();
const SUPPORT_CONTEXT_TIMEOUT_MS = 8_000;
const SUPPORT_OUTPUT_LIMIT = 10_000;
const SUPPORT_ACTION_OUTPUT_LIMIT = 24_000;

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function readEnvPresence() {
  const envPath = path.join(REPO_ROOT, ".env");
  const exists = fs.existsSync(envPath);
  const raw = exists ? fs.readFileSync(envPath, "utf8") : "";
  const keys = ["NODE_ENV", "PORT", "APP_PUBLIC_URL", "PM2_USER", "PM2_PASS_HASH", "JWT_SECRET", "METRICS_TOKEN", "CORS_ALLOWED_ORIGINS", "COOKIE_SECURE", "TRUST_PROXY"];
  const present = {};
  for (const key of keys) {
    present[key] = new RegExp(`^${key}=.+`, "m").test(raw);
  }
  return { exists, present };
}

function readBuildState() {
  const distPath = path.join(REPO_ROOT, "client", "dist");
  const assetsPath = path.join(distPath, "assets");
  let assetCount = 0;
  try {
    assetCount = fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath).length : 0;
  } catch (_error) {
    assetCount = 0;
  }
  return {
    indexExists: fs.existsSync(path.join(distPath, "index.html")),
    assetsExists: fs.existsSync(assetsPath),
    assetCount
  };
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(String(value || "null"));
  } catch (_error) {
    return null;
  }
}

function summarizeProcessesFromJlist(jlist) {
  if (!Array.isArray(jlist)) return [];
  return jlist.slice(0, 60).map((item) => ({
    name: item?.name,
    pm_id: item?.pm_id,
    status: item?.pm2_env?.status,
    restarts: item?.pm2_env?.restart_time,
    unstableRestarts: item?.pm2_env?.unstable_restarts,
    uptime: item?.pm2_env?.pm_uptime,
    memory: item?.monit?.memory,
    cpu: item?.monit?.cpu,
    cwd: item?.pm2_env?.pm_cwd,
    script: item?.pm2_env?.pm_exec_path
  }));
}

async function settledCommand(label, command, args, options = {}) {
  try {
    const result = await runCommand(command, args, {
      cwd: options.cwd || REPO_ROOT,
      timeoutMs: options.timeoutMs || SUPPORT_CONTEXT_TIMEOUT_MS
    });
    const output = truncateOutput(`${result.stdout || ""}\n${result.stderr || ""}`.trim(), options.outputLimit || SUPPORT_OUTPUT_LIMIT);
    return {
      label,
      command: formatCommand(command, args),
      code: result.code,
      timedOut: result.timedOut,
      output
    };
  } catch (error) {
    return {
      label,
      command: formatCommand(command, args),
      code: -1,
      timedOut: false,
      output: truncateOutput(error?.message || "Command failed", options.outputLimit || SUPPORT_OUTPUT_LIMIT)
    };
  }
}

async function collectSupportContext(context = {}) {
  const packageJson = safeReadJson(path.join(REPO_ROOT, "package.json"), {});
  const env = readEnvPresence();
  const build = readBuildState();
  const existingProcesses = Array.isArray(context?.processes) ? context.processes.slice(0, 60) : [];

  const [pm2Status, pm2Jlist, dashboardLogs, gitStatus, npmVersion] = await Promise.all([
    runPm2Cli(["status"], { outputLimit: 8000, timeoutMs: SUPPORT_CONTEXT_TIMEOUT_MS }),
    runPm2Cli(["jlist"], { outputLimit: 30000, timeoutMs: SUPPORT_CONTEXT_TIMEOUT_MS }),
    runPm2Cli(["logs", DASHBOARD_PROCESS_NAME, "--lines", "120", "--nostream", "--raw"], { outputLimit: 24000, timeoutMs: SUPPORT_CONTEXT_TIMEOUT_MS }),
    settledCommand("git status", "git", ["status", "--short", "--branch"], { outputLimit: 6000 }),
    settledCommand("npm version", npmCommand(), ["--version"], { outputLimit: 1000 })
  ]);

  const jlist = pm2Jlist.code === 0 ? parseMaybeJson(pm2Jlist.stdout) : null;
  const pm2Processes = summarizeProcessesFromJlist(jlist);
  const logs = dashboardLogs.output || "";
  const userText = Array.isArray(context?.messages)
    ? context.messages.map((message) => message?.content || "").join("\n")
    : String(context?.userText || "");

  const supportContext = {
    version: packageJson?.version || "unknown",
    processName: DASHBOARD_PROCESS_NAME,
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    env,
    build,
    npmVersion: npmVersion.output,
    git: gitStatus,
    pm2: {
      status: { code: pm2Status.code, timedOut: pm2Status.timedOut, output: pm2Status.output },
      jlistOk: pm2Jlist.code === 0,
      processes: pm2Processes.length ? pm2Processes : existingProcesses,
      dashboardLogs: { code: dashboardLogs.code, timedOut: dashboardLogs.timedOut, output: logs }
    },
    issues: []
  };

  supportContext.issues = inferSupportIssues(supportContext, userText);
  return supportContext;
}

function pushIssue(issues, id, title, evidence, actions = [], severity = "warning") {
  if (issues.some((item) => item.id === id)) return;
  issues.push({ id, title, evidence: trimText(evidence, 800), actions, severity });
}

function inferSupportIssues(supportContext, userText = "") {
  const issues = [];
  const haystack = `${userText}\n${supportContext?.pm2?.dashboardLogs?.output || ""}`.toLowerCase();
  const env = supportContext?.env?.present || {};
  const build = supportContext?.build || {};
  const dashboardProcess = (supportContext?.pm2?.processes || []).find((item) => item.name === supportContext.processName);

  const missingEnv = ["PM2_USER", "PM2_PASS_HASH", "JWT_SECRET", "METRICS_TOKEN"].filter((key) => !env[key]);
  if (missingEnv.length) {
    pushIssue(
      issues,
      "missing-production-env",
      "Generated production secrets are missing from .env or PM2 did not receive them.",
      `Missing keys: ${missingEnv.join(", ")}`,
      ["env-bootstrap", "restart-dashboard"],
      "danger"
    );
  }

  if (haystack.includes("production configuration is not safe") || haystack.includes("pm2_pass_hash is required") || haystack.includes("jwt_secret is required")) {
    pushIssue(
      issues,
      "env-guard-blocked-startup",
      "The server is blocked by production environment validation.",
      "Logs mention unsafe production configuration or missing required auth/secret values.",
      ["env-bootstrap", "restart-dashboard"],
      "danger"
    );
  }

  if (!build.indexExists || !build.assetsExists || Number(build.assetCount || 0) === 0) {
    pushIssue(
      issues,
      "frontend-build-missing",
      "The React production build is missing or incomplete.",
      `index.html: ${build.indexExists ? "yes" : "no"}; assets: ${build.assetCount || 0}`,
      ["build-dashboard", "restart-dashboard"],
      "warning"
    );
  }

  if (haystack.includes("mime type") || haystack.includes("not a supported stylesheet") || haystack.includes("/assets/") || haystack.includes("net::err_aborted 404")) {
    pushIssue(
      issues,
      "stale-frontend-assets",
      "The browser is loading a stale app shell that points to old hashed assets.",
      "The error mentions missing /assets files or wrong CSS MIME type.",
      ["build-dashboard", "restart-dashboard"],
      "warning"
    );
  }

  if (haystack.includes("route not found: get /dashboard")) {
    pushIssue(
      issues,
      "spa-fallback-missing",
      "The backend is not serving the React app for dashboard routes.",
      "The error is Route not found: GET /dashboard.",
      ["build-dashboard", "restart-dashboard"],
      "warning"
    );
  }

  if (haystack.includes("local changes to the following files would be overwritten") || haystack.includes("please commit your changes or stash them")) {
    pushIssue(
      issues,
      "git-pull-local-changes",
      "Git pull is blocked by local file changes.",
      "Git says local changes would be overwritten by merge.",
      ["git-status"],
      "warning"
    );
  }

  if (haystack.includes("edgesout") || haystack.includes("idealtree") || haystack.includes("arborist")) {
    pushIssue(
      issues,
      "npm-tree-corruption",
      "npm dependency tree/cache is corrupted or stale.",
      "The error mentions edgesOut / idealTree / Arborist.",
      ["npm-setup"],
      "warning"
    );
  }

  if (haystack.includes("cannot find type definition file") || haystack.includes("vite/client") || haystack.includes("vitest/globals") || haystack.includes("@testing-library/jest-dom")) {
    pushIssue(
      issues,
      "missing-type-dependencies",
      "Local dependencies are missing for TypeScript/Vite test types.",
      "VS Code/TypeScript cannot find vite/client, vitest/globals, jest-dom, or node types.",
      ["npm-setup"],
      "info"
    );
  }

  if (dashboardProcess && dashboardProcess.status && dashboardProcess.status !== "online") {
    pushIssue(
      issues,
      "dashboard-not-online",
      "The PM2 dashboard process is not online.",
      `${supportContext.processName} status: ${dashboardProcess.status}`,
      ["dashboard-logs", "env-bootstrap", "restart-dashboard"],
      "danger"
    );
  }

  const restartCount = Number(dashboardProcess?.restarts || 0);
  const unstableRestarts = Number(dashboardProcess?.unstableRestarts || 0);
  if (restartCount >= 5 || unstableRestarts > 0) {
    pushIssue(
      issues,
      "dashboard-restart-loop",
      "The dashboard process may be restarting repeatedly.",
      `Restarts: ${restartCount}; unstable restarts: ${unstableRestarts}`,
      ["dashboard-logs", "env-bootstrap"],
      "warning"
    );
  }

  if (!issues.length) {
    pushIssue(
      issues,
      "no-obvious-platform-error",
      "No obvious dashboard/server error found in the quick snapshot.",
      "PM2, Git, env, and build checks did not match a known failure pattern.",
      ["dashboard-logs", "pm2-status"],
      "info"
    );
  }

  return issues.slice(0, 6);
}


function looksLikeRepairIntent(userText = "") {
  const text = String(userText || "").toLowerCase();
  return /\b(fix|repair|make it work|doesn'?t work|not working|broken|solve|auto|deploy|production|restart|build|install|pull|error|crash|failed|help)\b/.test(text);
}

function uniqueActionIds(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function prioritizeSupportActions(actionIds = [], userText = "") {
  const wantsRepair = looksLikeRepairIntent(userText);
  const order = wantsRepair
    ? ["auto-repair", "support-diagnose", "dashboard-logs", "pm2-status", "git-status", "env-bootstrap", "npm-setup", "build-dashboard", "restart-dashboard"]
    : ["support-diagnose", "dashboard-logs", "pm2-status", "git-status", "env-bootstrap", "npm-setup", "build-dashboard", "restart-dashboard", "auto-repair"];
  const known = new Set(order);
  const unique = uniqueActionIds(actionIds);
  return [
    ...order.filter((id) => unique.includes(id)),
    ...unique.filter((id) => !known.has(id))
  ];
}

function mergeActionPlans(plan, fallbackPlan, userText = "") {
  const primary = normalizePlan(plan || {});
  const fallback = normalizePlan(fallbackPlan || {});
  const byId = new Map();

  for (const action of [...primary.actions, ...fallback.actions]) {
    if (!action?.actionId || byId.has(action.actionId)) continue;
    byId.set(action.actionId, action);
  }

  if (looksLikeRepairIntent(userText) && !byId.has("auto-repair")) {
    byId.set("auto-repair", {
      actionId: "auto-repair",
      payload: {},
      reason: "Run the safe repair sequence that matches the current dashboard evidence.",
      confidence: "high"
    });
  }

  const orderedIds = prioritizeSupportActions([...byId.keys()], userText).slice(0, AI_MAX_ACTIONS);
  return {
    reply: primary.reply || fallback.reply,
    actions: orderedIds.map((id) => byId.get(id)).filter(Boolean),
    riskNotes: uniqueActionIds([...(primary.riskNotes || []), ...(fallback.riskNotes || [])]).slice(0, 8)
  };
}

function createSupportFallbackPlan(supportContext, userText = "") {
  const issues = Array.isArray(supportContext?.issues) ? supportContext.issues : [];
  const primary = issues[0];
  const lines = [];
  if (primary) {
    lines.push(`I checked the server context. Main issue: ${primary.title}`);
    if (primary.evidence) lines.push(`Evidence: ${primary.evidence}`);
  } else {
    lines.push("I checked the server context and did not find a known failure pattern yet.");
  }
  if (issues.length > 1) {
    lines.push(`Also noticed: ${issues.slice(1, 3).map((issue) => issue.title).join("; ")}.`);
  }

  const actionIds = [];
  for (const issue of issues) {
    for (const actionId of issue.actions || []) {
      if (!actionIds.includes(actionId)) actionIds.push(actionId);
    }
  }

  if (looksLikeRepairIntent(userText) && !actionIds.includes("auto-repair")) {
    actionIds.unshift("auto-repair");
  }

  if (!actionIds.length) {
    actionIds.push("dashboard-logs", "pm2-status");
  }

  const orderedActionIds = prioritizeSupportActions(actionIds, userText);
  const actions = orderedActionIds.slice(0, AI_MAX_ACTIONS).map((actionId) => ({
    actionId,
    payload: defaultSupportActionPayload(actionId),
    reason: reasonForSupportAction(actionId, primary, userText),
    confidence: primary?.severity === "danger" ? "high" : "medium"
  }));

  return {
    reply: lines.join("\n"),
    actions,
    riskNotes: issues.filter((issue) => issue.severity === "danger").map((issue) => issue.title)
  };
}

function defaultSupportActionPayload(actionId) {
  if (actionId === "dashboard-logs") return { lines: 160 };
  return {};
}

function reasonForSupportAction(actionId, issue, _userText) {
  const map = {
    "support-diagnose": "Collect a fresh support snapshot before changing anything.",
    "dashboard-logs": "Read the dashboard PM2 logs so the fix uses real error output.",
    "pm2-status": "Check whether PM2 thinks the dashboard process is online or restarting.",
    "git-status": "Show which local files are blocking update/pull.",
    "env-bootstrap": "Restore generated production credentials/secrets into .env.",
    "build-dashboard": "Rebuild the React app so dashboard routes and assets exist.",
    "npm-setup": "Repair/install missing dependencies before building or typechecking.",
    "restart-dashboard": "Restart PM2 Manager with the latest build and env values.",
    "auto-repair": "Run the safe support-agent repair sequence based on the current evidence."
  };
  return map[actionId] || issue?.title || "Prepared from the dashboard support snapshot.";
}

function getSupportActionReference() {
  return [
    { actionId: "support-diagnose", label: "Diagnose dashboard", category: "support", risk: "read", fields: [] },
    { actionId: "dashboard-logs", label: "Dashboard logs", category: "support", risk: "sensitive-read", fields: [{ name: "lines", type: "number", required: false }] },
    { actionId: "pm2-status", label: "PM2 status", category: "support", risk: "read", fields: [] },
    { actionId: "git-status", label: "Git status", category: "support", risk: "read", fields: [] },
    { actionId: "env-bootstrap", label: "Repair env", category: "support", risk: "write", fields: [] },
    { actionId: "npm-setup", label: "Install/repair dependencies", category: "support", risk: "write", fields: [] },
    { actionId: "build-dashboard", label: "Build dashboard", category: "support", risk: "write", fields: [] },
    { actionId: "restart-dashboard", label: "Restart dashboard", category: "support", risk: "write", fields: [] },
    { actionId: "auto-repair", label: "Auto repair", category: "support", risk: "write", fields: [] }
  ];
}


function combineCommandResult(label, result) {
  return [
    `### ${label}`,
    `Command: ${result.command || label}`,
    `Exit: ${typeof result.code === "number" ? result.code : "unknown"}${result.timedOut ? " (timed out)" : ""}`,
    result.output ? result.output : "No output"
  ].join("\n");
}

function hasIssue(supportContext, id) {
  return Array.isArray(supportContext?.issues) && supportContext.issues.some((issue) => issue.id === id);
}

async function scheduleDashboardRestart(delayMs = 750) {
  const timer = setTimeout(() => {
    const child = spawn(npmCommand(), ["run", "pm2:restart"], {
      cwd: REPO_ROOT,
      stdio: "ignore",
      detached: true,
      windowsHide: true
    });
    child.unref();
  }, delayMs);
  if (typeof timer.unref === "function") timer.unref();
}

async function runDashboardAutoRepair() {
  const before = await collectSupportContext({});
  const output = ["Support agent auto-repair started."];
  const steps = [];
  let failed = false;

  const needsEnv = hasIssue(before, "missing-production-env") || hasIssue(before, "env-guard-blocked-startup");
  const needsInstall = hasIssue(before, "npm-tree-corruption") || hasIssue(before, "missing-type-dependencies");
  const needsBuild = needsInstall || hasIssue(before, "frontend-build-missing") || hasIssue(before, "stale-frontend-assets") || hasIssue(before, "spa-fallback-missing");
  const needsRestart = needsEnv || needsBuild || hasIssue(before, "dashboard-not-online") || hasIssue(before, "dashboard-restart-loop");

  async function runStep(label, command, args, options = {}) {
    if (failed) return null;
    const result = await settledCommand(label, command, args, {
      outputLimit: options.outputLimit || SUPPORT_ACTION_OUTPUT_LIMIT,
      timeoutMs: options.timeoutMs || COMMAND_TIMEOUT_MS,
      cwd: options.cwd || REPO_ROOT
    });
    steps.push({ label, code: result.code, timedOut: result.timedOut, command: result.command });
    output.push(combineCommandResult(label, result));
    if (result.code !== 0 || result.timedOut) failed = true;
    return result;
  }

  if (needsEnv) {
    await runStep("Repair generated environment", npmCommand(), ["run", "env:bootstrap"], { timeoutMs: 60_000 });
  }

  if (needsInstall) {
    await runStep("Install/repair dependencies", npmCommand(), ["run", "setup"], { timeoutMs: 10 * 60_000 });
  }

  if (needsBuild) {
    await runStep("Build dashboard UI", npmCommand(), ["run", "build"], { timeoutMs: 10 * 60_000 });
  }

  if (!needsEnv && !needsInstall && !needsBuild && !needsRestart) {
    output.push("No safe write repair was required from the current evidence. Keeping it read-only.");
  }

  if (!failed && needsRestart) {
    await scheduleDashboardRestart();
    steps.push({ label: "Restart dashboard", code: 0, timedOut: false, command: "npm run pm2:restart" });
    output.push("### Restart dashboard\nRestart accepted. PM2 Manager will restart in a moment.");
  }

  return {
    code: failed ? 1 : 0,
    output: truncateOutput(output.join("\n\n"), SUPPORT_ACTION_OUTPUT_LIMIT),
    stdout: output.join("\n\n"),
    stderr: failed ? "One or more safe repair steps failed." : "",
    repair: {
      beforeIssues: before.issues,
      steps
    }
  };
}

function buildPostRunSummary(plan, executions, postContext) {
  const executed = (executions || []).filter((item) => ["executed", "accepted"].includes(item.status));
  const blocked = (executions || []).filter((item) => item.status === "needs_confirmation");
  const failed = (executions || []).filter((item) => ["failed", "rejected"].includes(item.status));
  const remainingIssues = Array.isArray(postContext?.issues) ? postContext.issues : [];
  const lines = [];

  if (executed.length) {
    lines.push(`Worked on it: ${executed.map((item) => item.label || item.actionId).join(", ")}.`);
  } else if ((plan?.actions || []).length) {
    lines.push("I prepared the safe actions, but did not run write actions in the current mode.");
  } else {
    lines.push("I checked the dashboard and did not find an executable safe action from this request.");
  }

  if (failed.length) {
    lines.push(`Failed: ${failed.map((item) => `${item.label || item.actionId}${item.output ? ` — ${trimText(item.output, 160)}` : ""}`).join("; ")}.`);
  }

  if (blocked.length) {
    lines.push(`Needs confirmation: ${blocked.map((item) => item.label || item.actionId).join(", ")}.`);
  }

  if (remainingIssues.length) {
    lines.push(`Current finding: ${remainingIssues.slice(0, 2).map((issue) => issue.title).join("; ")}.`);
  } else {
    lines.push("No remaining known dashboard issue was detected in the final snapshot.");
  }

  return lines.join("\n");
}

function buildSupportActionInvocation(actionId, payload = {}) {
  const id = String(actionId || "").trim();
  const lines = Math.min(500, Math.max(40, Math.floor(Number(payload?.lines || 160))));
  if (id === "support-diagnose") {
    return {
      id,
      label: "Diagnose dashboard",
      risk: "read",
      support: true,
      run: async () => ({ code: 0, output: stringifyJsonForPrompt(await collectSupportContext({}), SUPPORT_ACTION_OUTPUT_LIMIT) })
    };
  }
  if (id === "dashboard-logs") {
    return {
      id,
      label: "Dashboard logs",
      risk: "sensitive-read",
      support: true,
      run: async () => runPm2Cli(["logs", DASHBOARD_PROCESS_NAME, "--lines", String(lines), "--nostream", "--raw"], { outputLimit: SUPPORT_ACTION_OUTPUT_LIMIT, timeoutMs: 20_000 })
    };
  }
  if (id === "pm2-status") {
    return { id, label: "PM2 status", risk: "read", support: true, run: async () => runPm2Cli(["status"], { outputLimit: SUPPORT_ACTION_OUTPUT_LIMIT, timeoutMs: 20_000 }) };
  }
  if (id === "git-status") {
    return { id, label: "Git status", risk: "read", support: true, run: async () => settledCommand("git status", "git", ["status", "--short", "--branch"], { outputLimit: SUPPORT_ACTION_OUTPUT_LIMIT, timeoutMs: 20_000 }) };
  }
  if (id === "env-bootstrap") {
    return { id, label: "Repair env", risk: "write", support: true, run: async () => settledCommand("env bootstrap", npmCommand(), ["run", "env:bootstrap"], { outputLimit: SUPPORT_ACTION_OUTPUT_LIMIT, timeoutMs: 60_000 }) };
  }
  if (id === "npm-setup") {
    return { id, label: "Install/repair dependencies", risk: "write", support: true, run: async () => settledCommand("npm setup", npmCommand(), ["run", "setup"], { outputLimit: SUPPORT_ACTION_OUTPUT_LIMIT, timeoutMs: 10 * 60_000 }) };
  }
  if (id === "build-dashboard") {
    return { id, label: "Build dashboard", risk: "write", support: true, run: async () => settledCommand("build dashboard", npmCommand(), ["run", "build"], { outputLimit: SUPPORT_ACTION_OUTPUT_LIMIT, timeoutMs: 10 * 60_000 }) };
  }
  if (id === "auto-repair") {
    return {
      id,
      label: "Auto repair",
      risk: "write",
      support: true,
      asyncRunReturnsAccepted: true,
      run: async () => runDashboardAutoRepair()
    };
  }

  if (id === "restart-dashboard") {
    return {
      id,
      label: "Restart dashboard",
      risk: "write",
      support: true,
      asyncRunReturnsAccepted: true,
      run: async () => {
        const timer = setTimeout(() => {
          const child = spawn(npmCommand(), ["run", "pm2:restart"], {
            cwd: REPO_ROOT,
            stdio: "ignore",
            detached: true,
            windowsHide: true
          });
          child.unref();
        }, 750);
        if (typeof timer.unref === "function") timer.unref();
        return { code: 0, output: "Restart accepted. PM2 Manager will restart in a moment." };
      }
    };
  }
  throw new Error("Unsupported AI support action");
}

function buildOperatorInvocation(actionId, payload = {}) {
  try {
    return buildPm2FeatureInvocation(actionId, payload || {});
  } catch (_pm2Error) {
    return buildSupportActionInvocation(actionId, payload || {});
  }
}

function trimText(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function stringifyJsonForPrompt(value, limit = 12000) {
  try {
    return JSON.stringify(value, null, 2).slice(0, limit);
  } catch (_error) {
    return "null";
  }
}

function getActionReference() {
  const catalog = getPm2FeatureCatalog();
  const pm2Actions = (catalog.features || []).map((feature) => ({
    actionId: feature.id,
    label: feature.label,
    category: feature.category,
    risk: feature.risk,
    fields: (feature.fields || []).map((field) => ({
      name: field.name,
      type: field.type,
      required: field.defaultValue === undefined || field.defaultValue === "",
      options: field.options ? field.options.map((option) => option.value) : undefined
    }))
  }));
  return [...getSupportActionReference(), ...pm2Actions];
}

function makeOperatorSystemPrompt(context = {}) {
  const processContext = Array.isArray(context?.processes)
    ? context.processes.slice(0, 50).map((process) => ({
        name: process.name,
        pm_id: process.pm_id ?? process.id,
        status: process.status || process.pm2_env?.status,
        cpu: process.cpu,
        memory: process.memory,
        restartCount: process.restartCount ?? process.pm2_env?.restart_time
      }))
    : [];

  return [
    "You are the PM2 Manager AI Operator inside a production operations dashboard.",
    "You help an authenticated operator fix real dashboard, PM2, Git, build, and deployment errors using evidence from the server.",
    "You are an operator planner, not a shell. You may only propose actions from the provided action catalog.",
    "When the user says fix, repair, make it work, or pastes an error, propose auto-repair when it safely applies.",
    "Prefer support-diagnose/dashboard-logs/pm2-status before PM2 write actions unless the current support context already proves the cause.",
    "Never propose delete, kill-daemon, unstartup, send-signal, or other critical actions unless the user explicitly asked for that exact disruption.",
    "Do not invent process names. Use the current process context when available. If target is unknown, use support-diagnose or ask for the target.",
    "Return strict JSON only, no markdown fences, no extra prose.",
    "Schema:",
    "{\"reply\":\"human readable answer\",\"actions\":[{\"actionId\":\"catalog id\",\"payload\":{},\"reason\":\"why this helps\",\"confidence\":\"low|medium|high\"}],\"riskNotes\":[\"short risk note\"]}",
    "Allowed PM2 actions:",
    stringifyJsonForPrompt(getActionReference(), 20000),
    "Current process context:",
    stringifyJsonForPrompt(processContext, 10000),
    "Current support context:",
    stringifyJsonForPrompt(context?.supportContext || {}, 16000)
  ].join("\n");
}

function parseJsonPlan(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { reply: "No response returned by the AI provider.", actions: [], riskNotes: [] };
  }

  const withoutFence = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;

  try {
    const parsed = JSON.parse(candidate);
    return normalizePlan(parsed);
  } catch (_error) {
    return {
      reply: withoutFence.slice(0, 4000),
      actions: [],
      riskNotes: ["The AI provider did not return the requested JSON plan, so no action was prepared."]
    };
  }
}

function normalizePlan(value) {
  const plan = value && typeof value === "object" ? value : {};
  const actions = Array.isArray(plan.actions)
    ? plan.actions.slice(0, AI_MAX_ACTIONS).map((action) => ({
        actionId: trimText(action?.actionId, 120),
        payload: action?.payload && typeof action.payload === "object" && !Array.isArray(action.payload) ? action.payload : {},
        reason: trimText(action?.reason, 500),
        confidence: ["low", "medium", "high"].includes(trimText(action?.confidence, 20)) ? trimText(action?.confidence, 20) : "medium"
      })).filter((action) => action.actionId)
    : [];

  return {
    reply: trimText(plan.reply, 6000) || "I prepared a PM2 action plan.",
    actions,
    riskNotes: Array.isArray(plan.riskNotes)
      ? plan.riskNotes.slice(0, 8).map((item) => trimText(item, 500)).filter(Boolean)
      : []
  };
}

function canAutoExecuteRisk(risk, executeMode) {
  if (executeMode === "write") {
    return risk === "read" || risk === "sensitive-read" || risk === "write";
  }
  if (executeMode === "read") {
    return risk === "read" || risk === "sensitive-read";
  }
  return false;
}

function normalizeRunCommandOptions(timeoutOrOptions = COMMAND_TIMEOUT_MS) {
  if (typeof timeoutOrOptions === "number") {
    return { cwd: REPO_ROOT, timeoutMs: Math.max(1, Math.floor(timeoutOrOptions)) };
  }
  const options = timeoutOrOptions && typeof timeoutOrOptions === "object" ? timeoutOrOptions : {};
  return {
    cwd: options.cwd || REPO_ROOT,
    timeoutMs: Number.isFinite(Number(options.timeoutMs)) ? Math.max(1, Math.floor(Number(options.timeoutMs))) : COMMAND_TIMEOUT_MS
  };
}

function runCommand(command, args, timeoutOrOptions = COMMAND_TIMEOUT_MS) {
  const { cwd, timeoutMs } = normalizeRunCommandOptions(timeoutOrOptions);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    if (typeof timeout.unref === "function") timeout.unref();

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: typeof code === "number" ? code : -1, timedOut, stdout, stderr });
    });
  });
}

function npmCommand(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function createPm2CliInvocation(pm2Args = [], platform = process.platform) {
  return {
    executable: npmCommand(platform),
    displayCommand: "npm",
    args: ["--prefix", "server", "exec", "pm2", "--", ...pm2Args.map((item) => String(item || "").trim())],
    cwd: REPO_ROOT
  };
}

function formatCommand(command, args = []) {
  return [String(command || "").trim(), ...args.map((item) => redactSecretsFromText(String(item || "").trim()))]
    .filter(Boolean)
    .join(" ");
}

function truncateOutput(value, limit = AI_ACTION_OUTPUT_LIMIT) {
  return redactSecretsFromText(String(value || "")).slice(-limit);
}

async function runPm2Cli(pm2Args = [], options = {}) {
  const outputLimit = Number.isFinite(Number(options.outputLimit))
    ? Math.max(1, Math.floor(Number(options.outputLimit)))
    : AI_ACTION_OUTPUT_LIMIT;
  const invocation = createPm2CliInvocation(pm2Args, options.platform);
  const commandLine = formatCommand(invocation.displayCommand, invocation.args);

  try {
    const result = await runCommand(invocation.executable, invocation.args, {
      cwd: invocation.cwd,
      timeoutMs: options.timeoutMs || COMMAND_TIMEOUT_MS
    });
    const combinedOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    return {
      command: commandLine,
      code: result.code,
      timedOut: result.timedOut,
      output: truncateOutput(combinedOutput, outputLimit),
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const message = String(error?.message || "Command failed");
    return {
      command: commandLine,
      code: -1,
      timedOut: false,
      output: truncateOutput(message, outputLimit),
      stdout: "",
      stderr: message
    };
  }
}

function isCommandSuccessful(result) {
  return result?.code === 0 && result?.timedOut !== true;
}

async function executePlannedActions(actions = [], executeMode = "plan", options = {}) {
  const results = [];
  const normalizedActions = Array.isArray(actions) ? actions.slice(0, AI_MAX_ACTIONS) : [];
  const autoRepairAction = normalizedActions.find((action) => action?.actionId === "auto-repair");
  const actionsToRun = executeMode === "write" && autoRepairAction ? [autoRepairAction] : normalizedActions;

  for (const planned of actionsToRun) {
    let invocation;
    try {
      invocation = buildOperatorInvocation(planned.actionId, planned.payload || {});
      if (requiresCriticalAcknowledgement(invocation) && options.acknowledge !== invocation.id) {
        results.push({
          actionId: invocation.id,
          label: invocation.label,
          risk: invocation.risk,
          status: "needs_confirmation",
          reason: "Critical actions require a manual confirmation before execution."
        });
        continue;
      }
      if (!canAutoExecuteRisk(invocation.risk, executeMode)) {
        results.push({
          actionId: invocation.id,
          label: invocation.label,
          risk: invocation.risk,
          status: "planned",
          reason: "Not executed because the current AI mode is plan/review only for this risk level."
        });
        continue;
      }

      let action;
      if (invocation.support && typeof invocation.run === "function") {
        const supportResult = await invocation.run();
        action = {
          command: invocation.label,
          code: supportResult.code,
          timedOut: Boolean(supportResult.timedOut),
          output: supportResult.output,
          stdout: supportResult.stdout || supportResult.output || "",
          stderr: supportResult.stderr || ""
        };
      } else {
        action = await runPm2Cli(invocation.args, {
          outputLimit: invocation.outputLimit || AI_ACTION_OUTPUT_LIMIT,
          timeoutMs: invocation.timeoutMs || COMMAND_TIMEOUT_MS
        });
      }
      const success = isCommandSuccessful(action);
      let parsed = null;
      if (success && invocation.parseJson) {
        try {
          parsed = JSON.parse(action.stdout || "null");
        } catch (_error) {
          parsed = null;
        }
      }
      trackPm2Operation(`ai:${invocation.id}`, success);
      results.push({
        actionId: invocation.id,
        label: invocation.label,
        risk: invocation.risk,
        status: invocation.asyncRunReturnsAccepted && success ? "accepted" : success ? "executed" : "failed",
        success,
        parsed,
        command: action.command,
        code: action.code,
        timedOut: action.timedOut,
        output: action.output
      });
    } catch (error) {
      results.push({
        actionId: planned.actionId,
        label: planned.actionId,
        risk: "unknown",
        status: "rejected",
        success: false,
        reason: error?.message || "Action rejected by the PM2 guardrails."
      });
    }
  }
  return results;
}

module.exports = {
  AI_MAX_ACTIONS,
  collectSupportContext,
  createSupportFallbackPlan,
  getActionReference,
  makeOperatorSystemPrompt,
  mergeActionPlans,
  buildPostRunSummary,
  parseJsonPlan,
  executePlannedActions
};

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
  ? Math.min(8, Math.max(1, Math.floor(Number(process.env.AI_MAX_ACTIONS))))
  : 4;

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
  return (catalog.features || []).map((feature) => ({
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
    "You help an authenticated operator understand PM2 state and plan safe operations.",
    "You are not a shell. You may only propose actions from the provided PM2 action catalog.",
    "Prefer observe/read actions before write actions unless the user's request is explicit.",
    "Never propose delete, kill-daemon, unstartup, send-signal, or other critical actions unless the user explicitly asked for that exact disruption.",
    "Do not invent process names. Use the current process context when available. Ask for a target when required.",
    "Return strict JSON only, no markdown fences, no extra prose.",
    "Schema:",
    "{\"reply\":\"human readable answer\",\"actions\":[{\"actionId\":\"catalog id\",\"payload\":{},\"reason\":\"why this helps\",\"confidence\":\"low|medium|high\"}],\"riskNotes\":[\"short risk note\"]}",
    "Allowed PM2 actions:",
    stringifyJsonForPrompt(getActionReference(), 20000),
    "Current process context:",
    stringifyJsonForPrompt(processContext, 10000)
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

async function executePlannedActions(actions = [], executeMode = "plan") {
  const results = [];
  for (const planned of actions.slice(0, AI_MAX_ACTIONS)) {
    let invocation;
    try {
      invocation = buildPm2FeatureInvocation(planned.actionId, planned.payload || {});
      if (requiresCriticalAcknowledgement(invocation)) {
        results.push({
          actionId: invocation.id,
          label: invocation.label,
          risk: invocation.risk,
          status: "needs_confirmation",
          reason: "Critical PM2 actions require a manual confirmation before execution."
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

      const action = await runPm2Cli(invocation.args, {
        outputLimit: invocation.outputLimit || AI_ACTION_OUTPUT_LIMIT,
        timeoutMs: invocation.timeoutMs || COMMAND_TIMEOUT_MS
      });
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
        status: success ? "executed" : "failed",
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
  getActionReference,
  makeOperatorSystemPrompt,
  parseJsonPlan,
  executePlannedActions
};

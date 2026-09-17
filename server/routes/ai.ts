const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { createRateLimiter, readLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { logger } = require("../utils/logger");
const { callAiProvider, normalizeMessages, PROVIDERS } = require("../utils/aiProvider");
const { collectSupportContext, createSupportFallbackPlan, makeOperatorSystemPrompt, mergeActionPlans, buildPostRunSummary, parseJsonPlan, executePlannedActions } = require("../utils/aiOperator");

const router = express.Router();

const aiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number.isFinite(Number(process.env.AI_RATE_LIMIT_MAX)) ? Math.max(1, Math.floor(Number(process.env.AI_RATE_LIMIT_MAX))) : 20,
  message: "Too many AI requests. Please retry shortly."
});

function normalizeExecuteMode(value) {
  const mode = String(value || "plan").trim().toLowerCase();
  return ["plan", "read", "write"].includes(mode) ? mode : "plan";
}

function getProviderConfig(body = {}) {
  return {
    provider: body.provider,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    model: body.model,
    temperature: body.temperature,
    maxTokens: body.maxTokens
  };
}

function isExplainedAgentTask(value) {
  const task = String(value || "").trim();
  return task.length >= 8 && /[a-z0-9]/i.test(task);
}

function trimAgentText(value, limit = 1200) {
  return String(value || "").trim().slice(0, limit);
}

function summarizeSupportContextForResponse(supportContext) {
  return {
    version: supportContext.version,
    processName: supportContext.processName,
    build: supportContext.build,
    env: supportContext.env,
    issues: supportContext.issues,
    git: supportContext.git,
    pm2: {
      status: supportContext.pm2?.status,
      jlistOk: supportContext.pm2?.jlistOk,
      processCount: Array.isArray(supportContext.pm2?.processes) ? supportContext.pm2.processes.length : 0
    }
  };
}

function buildAgentThoughts({ task, supportContext, plan, executions, executeMode, providerError }) {
  const issues = Array.isArray(supportContext?.issues) ? supportContext.issues : [];
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const results = Array.isArray(executions) ? executions : [];
  const thoughts = [
    `Task understood: ${trimAgentText(task, 140)}`,
    "Checked PM2 state, dashboard logs, Git state, environment keys, and frontend build files."
  ];

  if (issues.length) {
    thoughts.push(`Matched ${issues.length} finding${issues.length === 1 ? "" : "s"}: ${issues.slice(0, 2).map((issue) => issue.title).join("; ")}.`);
  } else {
    thoughts.push("No known dashboard failure pattern was detected from the snapshot.");
  }

  if (providerError) {
    thoughts.push("Provider call failed, so the local support agent handled the run.");
  } else {
    thoughts.push("Provider plan was merged with local guardrails before any action was considered.");
  }

  if (actions.length) {
    thoughts.push(`Prepared ${actions.length} guarded action${actions.length === 1 ? "" : "s"}: ${actions.slice(0, 3).map((action) => action.actionId).join(", ")}.`);
  } else {
    thoughts.push("No executable action was selected.");
  }

  if (executeMode === "plan") {
    thoughts.push("Plan mode: no server-changing action was executed.");
  } else if (executeMode === "read") {
    thoughts.push("Auto checks mode: only read/check actions were allowed.");
  } else {
    thoughts.push("Safe writes mode: only allowlisted non-critical repairs could run.");
  }

  const executed = results.filter((item) => ["executed", "accepted"].includes(item.status));
  const failed = results.filter((item) => ["failed", "rejected"].includes(item.status));
  const blocked = results.filter((item) => item.status === "needs_confirmation");
  if (executed.length) thoughts.push(`Completed: ${executed.map((item) => item.label || item.actionId).join(", ")}.`);
  if (failed.length) thoughts.push(`Failed: ${failed.map((item) => item.label || item.actionId).join(", ")}.`);
  if (blocked.length) thoughts.push(`Waiting for confirmation: ${blocked.map((item) => item.label || item.actionId).join(", ")}.`);
  return thoughts.slice(0, 8);
}

function buildAgentLogs({ supportContext, executions, providerError }) {
  const issues = Array.isArray(supportContext?.issues) ? supportContext.issues : [];
  const logs = [
    {
      level: "info",
      status: "done",
      title: "Evidence snapshot",
      message: `Processes: ${Array.isArray(supportContext?.pm2?.processes) ? supportContext.pm2.processes.length : 0}; issues: ${issues.length}; build assets: ${supportContext?.build?.assetCount || 0}.`
    }
  ];

  if (issues.length) {
    for (const issue of issues.slice(0, 3)) {
      logs.push({
        level: issue.severity || "info",
        status: issue.severity === "danger" ? "blocked" : "done",
        title: issue.title,
        message: trimAgentText(issue.evidence, 300)
      });
    }
  }

  if (providerError) {
    logs.push({ level: "warning", status: "done", title: "Provider fallback", message: trimAgentText(providerError, 300) });
  }

  for (const execution of Array.isArray(executions) ? executions : []) {
    logs.push({
      level: execution.success === false ? "error" : "info",
      status: execution.status || "planned",
      title: execution.label || execution.actionId || "Action",
      message: execution.reason || (execution.success === false ? "Action failed." : "Action processed."),
      command: execution.command,
      output: trimAgentText(execution.output, 2400)
    });
  }

  return logs.slice(0, 12);
}

function getAgentStatus(executions = []) {
  if (!Array.isArray(executions) || executions.length === 0) return "planned";
  if (executions.some((execution) => ["failed", "rejected"].includes(execution.status))) return "failed";
  if (executions.some((execution) => execution.status === "needs_confirmation")) return "blocked";
  if (executions.some((execution) => ["executed", "accepted"].includes(execution.status))) return "done";
  return "planned";
}

router.use(verifyToken);

router.get("/providers", readLimiter, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { providers: Object.values(PROVIDERS) }, error: null });
}));

router.post("/test", aiLimiter, asyncHandler(async (req, res) => {
  const config = getProviderConfig(req.body || {});
  const response = await callAiProvider(config, [
    { role: "system", content: "You are testing connectivity. Reply with a short OK message only." },
    { role: "user", content: "Test PM2 Manager AI connection." }
  ], { timeoutMs: 30_000 });

  res.json({
    success: true,
    data: {
      provider: response.provider,
      model: response.model,
      endpoint: response.endpoint,
      message: response.content.slice(0, 500) || "OK"
    },
    error: null
  });
}));

router.post("/diagnose", aiLimiter, asyncHandler(async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const userText = messages.map((message) => message?.content || "").join("\n") || String(req.body?.prompt || "");
  const supportContext = await collectSupportContext({
    userText,
    messages,
    processes: Array.isArray(req.body?.processes) ? req.body.processes : []
  });
  const plan = createSupportFallbackPlan(supportContext, userText);

  res.json({
    success: true,
    data: {
      reply: plan.reply,
      actions: plan.actions,
      executions: [],
      riskNotes: plan.riskNotes,
      supportContext: {
        version: supportContext.version,
        processName: supportContext.processName,
        build: supportContext.build,
        env: supportContext.env,
        issues: supportContext.issues,
        git: supportContext.git,
        pm2: {
          status: supportContext.pm2?.status,
          jlistOk: supportContext.pm2?.jlistOk,
          processCount: Array.isArray(supportContext.pm2?.processes) ? supportContext.pm2.processes.length : 0
        }
      }
    },
    error: null
  });
}));

router.post("/actions/run", aiLimiter, asyncHandler(async (req, res) => {
  const actionId = String(req.body?.actionId || "").trim();
  const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
  const acknowledge = String(req.body?.acknowledge || "").trim();
  const executions = await executePlannedActions([{ actionId, payload }], "write", { acknowledge });
  const execution = executions[0] || null;

  res.status(execution?.status === "needs_confirmation" ? 409 : 200).json({
    success: execution ? execution.success !== false || execution.status === "accepted" || execution.status === "needs_confirmation" : false,
    data: execution,
    error: execution ? null : "Action did not return a result"
  });
}));


router.post("/agent/run", aiLimiter, asyncHandler(async (req, res) => {
  const task = String(req.body?.task || "").trim();
  if (!isExplainedAgentTask(task)) {
    res.status(400).json({
      success: false,
      data: null,
      error: "Explain the task or error before spawning an agent."
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const executeMode = normalizeExecuteMode(req.body?.executeMode);
  const incomingMessages = normalizeMessages(req.body?.messages);
  const messages = incomingMessages.length ? incomingMessages : [{ role: "user", content: task }];
  const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const userText = `${task}\n${messages.map((message) => message.content).join("\n")}`;
  const supportContext = await collectSupportContext({ ...context, messages, userText });
  const fallbackPlan = createSupportFallbackPlan(supportContext, userText);
  const systemPrompt = makeOperatorSystemPrompt({ ...context, supportContext });
  const providerMessages = [
    {
      role: "system",
      content: `${systemPrompt}\nYou are now running as an interactive repair agent. Only act on the user's specific task. Use safe summarized reasoning, evidence, and the allowed action catalog.`
    },
    ...messages.filter((message) => message.role !== "system"),
    { role: "user", content: `Agent task: ${task}` }
  ];

  let aiResponse;
  let plan;
  let providerError = "";
  try {
    aiResponse = await callAiProvider(getProviderConfig(req.body || {}), providerMessages, {
      timeoutMs: Number.isFinite(Number(process.env.AI_TIMEOUT_MS)) ? Math.max(5000, Math.floor(Number(process.env.AI_TIMEOUT_MS))) : 90_000
    });
    plan = mergeActionPlans(parseJsonPlan(aiResponse.content), fallbackPlan, userText);
  } catch (error) {
    providerError = error?.message || "AI provider call failed";
    aiResponse = {
      provider: req.body?.provider || "offline-diagnostics",
      model: req.body?.model || "local-support-agent",
      endpoint: "local-support-diagnostics",
      rawUsage: null
    };
    plan = {
      ...fallbackPlan,
      reply: `${fallbackPlan.reply}\n\nLocal agent handled the task because the provider was unavailable.`.trim()
    };
  }

  const executions = await executePlannedActions(plan.actions, executeMode);
  const shouldRefreshContext = executions.some((execution) => ["executed", "accepted", "failed"].includes(execution.status));
  const executionText = executions.map((execution) => execution.output || execution.reason || "").join("\n");
  const postContext = shouldRefreshContext
    ? await collectSupportContext({ ...context, messages, userText: `${userText}\n${executionText}` })
    : supportContext;
  const operatorSummary = buildPostRunSummary(plan, executions, postContext);
  const thoughts = buildAgentThoughts({ task, supportContext: postContext, plan, executions, executeMode, providerError });
  const logs = buildAgentLogs({ supportContext: postContext, executions, providerError });
  const finalReply = [plan.reply, operatorSummary].filter(Boolean).join("\n\n");

  logger.info("ai_agent_run", {
    provider: aiResponse.provider,
    model: aiResponse.model,
    executeMode,
    actions: plan.actions.map((action) => action.actionId),
    executions: executions.map((execution) => ({ actionId: execution.actionId, status: execution.status }))
  });

  res.json({
    success: true,
    data: {
      provider: aiResponse.provider,
      model: aiResponse.model,
      endpoint: aiResponse.endpoint,
      usage: aiResponse.rawUsage,
      reply: finalReply,
      actions: plan.actions,
      executions,
      riskNotes: plan.riskNotes,
      supportContext: summarizeSupportContextForResponse(postContext),
      agentRun: {
        runId: `agent_${Date.now().toString(36)}`,
        status: getAgentStatus(executions),
        mode: executeMode,
        task,
        startedAt,
        finishedAt: new Date().toISOString(),
        thoughts,
        logs
      }
    },
    error: null
  });
}));

router.post("/chat", aiLimiter, asyncHandler(async (req, res) => {
  const executeMode = normalizeExecuteMode(req.body?.executeMode);
  const messages = normalizeMessages(req.body?.messages);
  const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const userText = messages.map((message) => message.content).join("\n");
  const supportContext = await collectSupportContext({ ...context, messages, userText });
  const fallbackPlan = createSupportFallbackPlan(supportContext, userText);
  const systemPrompt = makeOperatorSystemPrompt({ ...context, supportContext });
  const providerMessages = [
    { role: "system", content: systemPrompt },
    ...messages.filter((message) => message.role !== "system")
  ];

  let aiResponse;
  let plan;
  try {
    aiResponse = await callAiProvider(getProviderConfig(req.body || {}), providerMessages, {
      timeoutMs: Number.isFinite(Number(process.env.AI_TIMEOUT_MS)) ? Math.max(5000, Math.floor(Number(process.env.AI_TIMEOUT_MS))) : 90_000
    });
    plan = mergeActionPlans(parseJsonPlan(aiResponse.content), fallbackPlan, userText);
  } catch (error) {
    aiResponse = {
      provider: req.body?.provider || "offline-diagnostics",
      model: req.body?.model || "support-agent",
      endpoint: "local-support-diagnostics",
      rawUsage: null
    };
    plan = {
      ...fallbackPlan,
      reply: `${fallbackPlan.reply}\n\nAI provider call failed, so I used the local support diagnosis instead. ${error?.message || ""}`.trim()
    };
  }
  const executions = await executePlannedActions(plan.actions, executeMode);
  const shouldRefreshContext = executions.some((execution) => ["executed", "accepted", "failed"].includes(execution.status));
  const executionText = executions.map((execution) => execution.output || execution.reason || "").join("\n");
  const postContext = shouldRefreshContext
    ? await collectSupportContext({ ...context, messages, userText: `${userText}\n${executionText}` })
    : supportContext;
  const operatorSummary = buildPostRunSummary(plan, executions, postContext);
  const finalReply = [plan.reply, operatorSummary].filter(Boolean).join("\n\n");

  logger.info("ai_operator_request", {
    provider: aiResponse.provider,
    model: aiResponse.model,
    executeMode,
    actions: plan.actions.map((action) => action.actionId),
    executions: executions.map((execution) => ({ actionId: execution.actionId, status: execution.status }))
  });

  res.json({
    success: true,
    data: {
      provider: aiResponse.provider,
      model: aiResponse.model,
      endpoint: aiResponse.endpoint,
      usage: aiResponse.rawUsage,
      reply: finalReply,
      actions: plan.actions,
      riskNotes: plan.riskNotes,
      supportContext: {
        version: postContext.version,
        processName: postContext.processName,
        build: postContext.build,
        env: postContext.env,
        issues: postContext.issues,
        git: postContext.git,
        pm2: {
          status: postContext.pm2?.status,
          jlistOk: postContext.pm2?.jlistOk,
          processCount: Array.isArray(postContext.pm2?.processes) ? postContext.pm2.processes.length : 0
        }
      },
      executions
    },
    error: null
  });
}));

module.exports = router;

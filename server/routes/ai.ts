const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { createRateLimiter, readLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { logger } = require("../utils/logger");
const { callAiProvider, normalizeMessages, PROVIDERS, getServerAiDefaults } = require("../utils/aiProvider");
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

function getLatestUserText(messages = []) {
  const latest = [...messages].reverse().find((message) => message?.role === "user");
  return String(latest?.content || "").trim();
}

function isAgentLoopRequest(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;

  const casualOnly = /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|yes|no|test|ping|are you there|how are you)[!?.\s]*$/i.test(text);
  if (casualOnly) return false;

  const asksForProblem = /\b(what'?s the problem|what is the problem|what happened|why is it broken|root cause|find the issue|find the problem|tell me the issue|any issue|what went wrong)\b/.test(text);
  const asksForAgent = /\b(spawn|start|run|enter)\b.{0,24}\b(agent|diagnostic|diagnostics|loop|investigation)\b/.test(text) || /\b(agent loop|diagnostic loop|debug loop)\b/.test(text);
  const asksForDiagnostics = /\b(debug|diagnose|diagnostics|troubleshoot|investigate|inspect logs?|check logs?|check pm2|check server|analyze (this )?(error|logs?|crash|failure))\b/.test(text);
  const pastedErrorEvidence = /\b(error|exception|traceback|stack trace|enoent|eacces|eaddrinuse|not defined|cannot find module|failed|crash|timeout|404|500|502|503|npm err|vite|typescript|typeerror|referenceerror|pm2|git pull|merge conflict)\b/.test(text) && text.length >= 12;

  return asksForProblem || asksForAgent || asksForDiagnostics || pastedErrorEvidence;
}

function buildChatSystemPrompt() {
  return [
    "You are the chat-first PM2 Manager assistant.",
    "Reply conversationally and help the operator decide what to do next.",
    "Stay in normal conversation mode unless the latest user message explicitly asks for diagnostics, asks what the problem is, asks to spawn an agent/loop, or includes concrete error/log output.",
    "Do not claim that you inspected logs, checked PM2, ran Git, debugged, repaired, deployed, restarted, or changed files unless the server returned that evidence from an agent loop.",
    "For casual messages, greet the user normally.",
    "For non-diagnostic tasks, explain the next safe step and ask before any action is run.",
    "Keep replies short and practical."
  ].join("\n");
}

function buildProviderUsage(aiResponse) {
  return aiResponse?.rawUsage || null;
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


router.use(verifyToken);

router.get("/providers", readLimiter, asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      providers: Object.values(PROVIDERS),
      serverDefaults: getServerAiDefaults()
    },
    error: null
  });
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
  const incomingMessages = Array.isArray(req.body?.messages) && req.body.messages.length ? normalizeMessages(req.body.messages) : [];
  const messages = incomingMessages.length ? incomingMessages : [{ role: "user", content: task }];
  const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const userText = `${task}\n${messages.map((message) => message.content).join("\n")}`;
  const supportContext = await collectSupportContext({ ...context, messages, userText });
  const fallbackPlan = createSupportFallbackPlan(supportContext, task);
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
    plan = mergeActionPlans(parseJsonPlan(aiResponse.content), fallbackPlan, task);
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

  const executions = await executePlannedActions(plan.actions, "plan");
  const operatorSummary = buildPostRunSummary(plan, executions, supportContext);
  const thoughts = buildAgentThoughts({ task, supportContext, plan, executions, executeMode: "plan", providerError });
  const logs = buildAgentLogs({ supportContext, executions, providerError });
  const finalReply = [plan.reply, operatorSummary, "Agent loop finished with feedback only. Nothing was executed. Choose a prepared action to run it."].filter(Boolean).join("\n\n");

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
      supportContext: summarizeSupportContextForResponse(supportContext),
      agentRun: {
        runId: `agent_${Date.now().toString(36)}`,
        status: "planned",
        mode: "plan",
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
  const messages = normalizeMessages(req.body?.messages);
  const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const latestUserText = getLatestUserText(messages);
  const userText = messages.map((message) => message.content).join("\n");
  const shouldEnterAgentLoop = isAgentLoopRequest(latestUserText);

  if (!messages.length) {
    res.status(400).json({ success: false, data: null, error: "Type a message first." });
    return;
  }

  if (!shouldEnterAgentLoop) {
    let aiResponse;
    let reply = "Hey — tell me what you want to check or change, and I’ll ask before running anything.";
    try {
      aiResponse = await callAiProvider(getProviderConfig(req.body || {}), [
        { role: "system", content: buildChatSystemPrompt() },
        ...messages.filter((message) => message.role !== "system")
      ], {
        timeoutMs: Number.isFinite(Number(process.env.AI_TIMEOUT_MS)) ? Math.max(5000, Math.floor(Number(process.env.AI_TIMEOUT_MS))) : 60_000
      });
      reply = trimAgentText(aiResponse.content, 4000) || reply;
    } catch (error) {
      aiResponse = {
        provider: req.body?.provider || "local-chat",
        model: req.body?.model || "chat-first-fallback",
        endpoint: "local-chat",
        rawUsage: null
      };
      logger.warn("ai_chat_provider_fallback", { error: error?.message || "AI provider failed" });
    }

    res.json({
      success: true,
      data: {
        provider: aiResponse.provider,
        model: aiResponse.model,
        endpoint: aiResponse.endpoint,
        usage: buildProviderUsage(aiResponse),
        reply,
        actions: [],
        riskNotes: [],
        supportContext: null,
        executions: [],
        agentRun: {
          runId: `chat_${Date.now().toString(36)}`,
          status: "idle",
          mode: "chat",
          task: userText,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          thoughts: ["Normal chat mode: no diagnostics, logs, PM2, Git, build checks, or server actions were started."],
          logs: []
        }
      },
      error: null
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const supportContext = await collectSupportContext({ ...context, messages, userText: latestUserText });
  const fallbackPlan = createSupportFallbackPlan(supportContext, latestUserText);
  const systemPrompt = `${makeOperatorSystemPrompt({ ...context, supportContext })}\nYou are in chat-first planning mode. Prepare suggestions only. Do not execute actions. Ask the user to confirm from the prepared actions before anything runs.`;
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
    plan = mergeActionPlans(parseJsonPlan(aiResponse.content), fallbackPlan, latestUserText);
  } catch (error) {
    aiResponse = {
      provider: req.body?.provider || "offline-diagnostics",
      model: req.body?.model || "support-planner",
      endpoint: "local-support-planner",
      rawUsage: null
    };
    plan = {
      ...fallbackPlan,
      reply: `${fallbackPlan.reply}\n\nAI provider call failed, so I prepared a local plan only. ${error?.message || ""}`.trim()
    };
  }

  const executions = await executePlannedActions(plan.actions, "plan");
  const operatorSummary = buildPostRunSummary(plan, executions, supportContext);
  const finalReply = [plan.reply, operatorSummary, "Agent loop finished with feedback only. Nothing was executed. Choose a prepared action to run it."].filter(Boolean).join("\n\n");
  const thoughts = buildAgentThoughts({ task: latestUserText, supportContext, plan, executions, executeMode: "plan", providerError: "" });
  const logs = buildAgentLogs({ supportContext, executions, providerError: "" });

  logger.info("ai_operator_chat_plan", {
    provider: aiResponse.provider,
    model: aiResponse.model,
    actions: plan.actions.map((action) => action.actionId)
  });

  res.json({
    success: true,
    data: {
      provider: aiResponse.provider,
      model: aiResponse.model,
      endpoint: aiResponse.endpoint,
      usage: buildProviderUsage(aiResponse),
      reply: finalReply,
      actions: plan.actions,
      riskNotes: plan.riskNotes,
      supportContext: summarizeSupportContextForResponse(supportContext),
      executions,
      agentRun: {
        runId: `plan_${Date.now().toString(36)}`,
        status: "planned",
        mode: "agent-loop",
        task: userText,
        startedAt,
        finishedAt: new Date().toISOString(),
        thoughts,
        logs
      }
    },
    error: null
  });
}));

module.exports = router;

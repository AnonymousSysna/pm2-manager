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
      reply: finalReply,
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

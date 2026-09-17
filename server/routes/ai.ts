const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { createRateLimiter, readLimiter } = require("../middleware/rateLimit");
const { asyncHandler } = require("../middleware/asyncHandler");
const { logger } = require("../utils/logger");
const { callAiProvider, normalizeMessages, PROVIDERS } = require("../utils/aiProvider");
const { makeOperatorSystemPrompt, parseJsonPlan, executePlannedActions } = require("../utils/aiOperator");

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

router.post("/chat", aiLimiter, asyncHandler(async (req, res) => {
  const executeMode = normalizeExecuteMode(req.body?.executeMode);
  const messages = normalizeMessages(req.body?.messages);
  const context = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
  const systemPrompt = makeOperatorSystemPrompt(context);
  const providerMessages = [
    { role: "system", content: systemPrompt },
    ...messages.filter((message) => message.role !== "system")
  ];

  const aiResponse = await callAiProvider(getProviderConfig(req.body || {}), providerMessages, {
    timeoutMs: Number.isFinite(Number(process.env.AI_TIMEOUT_MS)) ? Math.max(5000, Math.floor(Number(process.env.AI_TIMEOUT_MS))) : 90_000
  });
  const plan = parseJsonPlan(aiResponse.content);
  const executions = await executePlannedActions(plan.actions, executeMode);

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
      reply: plan.reply,
      actions: plan.actions,
      riskNotes: plan.riskNotes,
      executions
    },
    error: null
  });
}));

module.exports = router;

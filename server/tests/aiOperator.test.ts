const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJsonPlan } = require("../utils/aiOperator");
const { normalizeBaseUrl } = require("../utils/aiProvider");

test("AI operator parses a strict JSON action plan", () => {
  const plan = parseJsonPlan(JSON.stringify({
    reply: "Check status first.",
    actions: [{ actionId: "status", payload: {}, reason: "Baseline state", confidence: "high" }],
    riskNotes: []
  }));

  assert.equal(plan.reply, "Check status first.");
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].actionId, "status");
});

test("AI provider URL normalization strips credentials and trailing slash", () => {
  const normalized = normalizeBaseUrl("https://user:pass@example.com/v1/", "openai-compatible");
  assert.equal(normalized, "https://example.com/v1");
});

const { redactSecretsFromText, scrubUrl } = require("./urlSafety");

const PROVIDERS = {
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI compatible",
    baseUrl: "https://api.openai.com/v1",
    notes: "jcode-style OpenAI-compatible chat completions. Works with OpenAI, OpenRouter, LM Studio, Ollama-compatible gateways, and private gateways."
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com",
    notes: "Direct Anthropic Messages API provider for Claude models."
  }
};

const SAFE_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 16000;
const MAX_RESPONSE_CHARS = 24000;
const MAX_MODEL_CHARS = 160;
const MAX_API_KEY_CHARS = 12000;
const MAX_BASE_URL_CHARS = 600;

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = asString(value).trim();
    if (text) return text;
  }
  return "";
}

function configuredProvider(value) {
  return firstNonEmpty(value, process.env.AI_PROVIDER, process.env.LLM_PROVIDER, "openai-compatible");
}

function modelEnvForProvider(provider) {
  return provider === "anthropic"
    ? firstNonEmpty(process.env.AI_MODEL, process.env.ANTHROPIC_MODEL, process.env.CLAUDE_MODEL)
    : firstNonEmpty(process.env.AI_MODEL, process.env.OPENAI_MODEL, process.env.OPENAI_COMPATIBLE_MODEL);
}

function apiKeyEnvForProvider(provider) {
  return provider === "anthropic"
    ? firstNonEmpty(process.env.AI_API_KEY, process.env.ANTHROPIC_API_KEY, process.env.AI_ANTHROPIC_API_KEY)
    : firstNonEmpty(process.env.AI_API_KEY, process.env.OPENAI_API_KEY, process.env.OPENAI_COMPATIBLE_API_KEY);
}

function baseUrlEnvForProvider(provider) {
  return provider === "anthropic"
    ? firstNonEmpty(process.env.AI_BASE_URL, process.env.ANTHROPIC_BASE_URL)
    : firstNonEmpty(process.env.AI_BASE_URL, process.env.OPENAI_BASE_URL, process.env.OPENAI_COMPATIBLE_BASE_URL);
}

function normalizeProvider(value) {
  const provider = configuredProvider(value).trim().toLowerCase();
  if (PROVIDERS[provider]) {
    return provider;
  }
  throw new Error("AI provider is not supported yet");
}

function isLocalUrl(parsed) {
  return SAFE_LOCAL_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith(".local");
}

function normalizeBaseUrl(value, provider) {
  const fallback = baseUrlEnvForProvider(provider) || PROVIDERS[provider]?.baseUrl || PROVIDERS["openai-compatible"].baseUrl;
  const raw = asString(value).trim() || fallback;
  if (raw.length > MAX_BASE_URL_CHARS) {
    throw new Error("AI base URL is too long");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_error) {
    throw new Error("AI base URL must be a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("AI base URL must use http or https");
  }

  const allowHttp = String(process.env.AI_ALLOW_HTTP || "").trim() === "1";
  if (parsed.protocol === "http:" && process.env.NODE_ENV === "production" && !allowHttp && !isLocalUrl(parsed)) {
    throw new Error("Production AI providers must use HTTPS unless AI_ALLOW_HTTP=1 is set for a trusted local gateway");
  }

  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  return parsed.toString().replace(/\/$/, "");
}

function validateApiKey(value) {
  const apiKey = asString(value).trim();
  if (!apiKey) {
    throw new Error("AI API key is required");
  }
  if (apiKey.length > MAX_API_KEY_CHARS) {
    throw new Error("AI API key is too long");
  }
  return apiKey;
}

function validateModel(value) {
  const model = asString(value).trim();
  if (!model) {
    throw new Error("AI model is required");
  }
  if (model.length > MAX_MODEL_CHARS || /[\r\n<>]/.test(model)) {
    throw new Error("AI model contains invalid characters");
  }
  return model;
}

function resolveApiKey(value, provider) {
  return validateApiKey(firstNonEmpty(value, apiKeyEnvForProvider(provider)));
}

function resolveModel(value, provider) {
  return validateModel(firstNonEmpty(value, modelEnvForProvider(provider)));
}

function getServerAiDefaults() {
  let provider = "openai-compatible";
  try {
    provider = normalizeProvider("");
  } catch (_error) {
    provider = "openai-compatible";
  }

  let baseUrl = PROVIDERS[provider]?.baseUrl || PROVIDERS["openai-compatible"].baseUrl;
  try {
    baseUrl = normalizeBaseUrl("", provider);
  } catch (_error) {
    baseUrl = PROVIDERS[provider]?.baseUrl || PROVIDERS["openai-compatible"].baseUrl;
  }
  const model = modelEnvForProvider(provider);
  return {
    provider,
    baseUrl: scrubUrl(baseUrl),
    model,
    hasApiKey: Boolean(apiKeyEnvForProvider(provider)),
    keySource: apiKeyEnvForProvider(provider) ? "server-env" : "browser-input",
    supportedEnv: {
      provider: ["AI_PROVIDER", "LLM_PROVIDER"],
      baseUrl: provider === "anthropic" ? ["AI_BASE_URL", "ANTHROPIC_BASE_URL"] : ["AI_BASE_URL", "OPENAI_BASE_URL", "OPENAI_COMPATIBLE_BASE_URL"],
      model: provider === "anthropic" ? ["AI_MODEL", "ANTHROPIC_MODEL", "CLAUDE_MODEL"] : ["AI_MODEL", "OPENAI_MODEL", "OPENAI_COMPATIBLE_MODEL"],
      apiKey: provider === "anthropic" ? ["AI_API_KEY", "ANTHROPIC_API_KEY", "AI_ANTHROPIC_API_KEY"] : ["AI_API_KEY", "OPENAI_API_KEY", "OPENAI_COMPATIBLE_API_KEY"]
    }
  };
}

function normalizeMessages(value) {
  const rawMessages = Array.isArray(value) ? value : [];
  const messages = rawMessages
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: ["system", "user", "assistant"].includes(asString(message?.role)) ? message.role : "user",
      content: asString(message?.content).slice(0, MAX_MESSAGE_CHARS)
    }))
    .filter((message) => message.content.trim());

  if (messages.length === 0) {
    throw new Error("At least one AI message is required");
  }

  return messages;
}

function appendPath(baseUrl, pathname) {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith(pathname)) {
    return normalized;
  }
  if (pathname === "/chat/completions" && normalized.endsWith("/v1")) {
    return `${normalized}${pathname}`;
  }
  if (pathname === "/v1/messages" && normalized.endsWith("/v1")) {
    return `${normalized}/messages`;
  }
  return `${normalized}${pathname}`;
}

function openAiMessages(messages) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function anthropicMessages(messages) {
  const systemParts = [];
  const chat = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    chat.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    });
  }

  const compactChat = [];
  for (const message of chat) {
    const previous = compactChat[compactChat.length - 1];
    if (previous && previous.role === message.role) {
      previous.content += `\n\n${message.content}`;
    } else {
      compactChat.push({ ...message });
    }
  }

  if (compactChat[0]?.role === "assistant") {
    compactChat.unshift({ role: "user", content: "Continue the PM2 operations conversation." });
  }

  return {
    system: systemParts.join("\n\n"),
    messages: compactChat.length > 0 ? compactChat : [{ role: "user", content: "Hello" }]
  };
}

function extractOpenAiText(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const messageContent = choice?.message?.content;
  if (typeof messageContent === "string") {
    return messageContent;
  }
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => (typeof part?.text === "string" ? part.text : typeof part === "string" ? part : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof payload?.output_text === "string") {
    return payload.output_text;
  }
  return "";
}

function extractAnthropicText(payload) {
  if (typeof payload?.content === "string") {
    return payload.content;
  }
  if (Array.isArray(payload?.content)) {
    return payload.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function callAiProvider(config, messages, options = {}) {
  const provider = normalizeProvider(config?.provider);
  const baseUrl = normalizeBaseUrl(config?.baseUrl, provider);
  const apiKey = resolveApiKey(config?.apiKey, provider);
  const model = resolveModel(config?.model, provider);
  const temperature = Number.isFinite(Number(config?.temperature)) ? Math.min(1, Math.max(0, Number(config.temperature))) : 0.2;
  const maxTokens = Number.isFinite(Number(config?.maxTokens)) ? Math.min(4000, Math.max(256, Math.floor(Number(config.maxTokens)))) : 1800;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Math.max(5000, Math.floor(Number(options.timeoutMs))) : 90_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let url;
  let body;
  let headers;

  if (provider === "anthropic") {
    const anthropic = anthropicMessages(messages);
    url = appendPath(baseUrl, "/v1/messages");
    headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
    body = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages: anthropic.messages
    };
    if (anthropic.system) {
      body.system = anthropic.system;
    }
  } else {
    url = appendPath(baseUrl, "/chat/completions");
    headers = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    };
    body = {
      model,
      temperature,
      max_tokens: maxTokens,
      messages: openAiMessages(messages)
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_error) {
      payload = null;
    }

    if (!response.ok) {
      const errorMessage = payload?.error?.message || payload?.message || text || `AI provider returned HTTP ${response.status}`;
      const error = new Error(redactSecretsFromText(errorMessage).slice(0, 1000));
      error.status = response.status;
      error.provider = provider;
      error.url = scrubUrl(url);
      throw error;
    }

    const content = provider === "anthropic" ? extractAnthropicText(payload) : extractOpenAiText(payload);
    return {
      provider,
      model,
      baseUrl: scrubUrl(baseUrl),
      endpoint: scrubUrl(url),
      content: String(content || "").slice(0, MAX_RESPONSE_CHARS),
      rawUsage: isPlainObject(payload?.usage) ? payload.usage : null
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  PROVIDERS,
  callAiProvider,
  getServerAiDefaults,
  normalizeProvider,
  normalizeBaseUrl,
  normalizeMessages,
  validateApiKey,
  validateModel
};

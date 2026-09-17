import api from "./index";
import {
  isIdempotent,
  normalizeApiError,
  retryDelayMs,
  shouldRetryRequest
} from "../lib/apiError";

type AdapterCall = { method?: string; url?: string; _retryCount?: number };

function makeResponse(status: number, data: unknown = {}) {
  return {
    data,
    status,
    statusText: String(status),
    headers: {},
    config: {} as never
  };
}

function installAdapter(script: Array<{ status: number; data?: unknown } | { error: unknown }>) {
  const calls: AdapterCall[] = [];
  api.defaults.adapter = async (config) => {
    calls.push({
      method: String(config.method || "get").toLowerCase(),
      url: String(config.url || ""),
      _retryCount: (config as { _retryCount?: number })._retryCount
    });
    const step = script.shift();
    if (!step) {
      throw new Error("adapter script exhausted");
    }
    if ("error" in step) {
      throw step.error;
    }
    const response = makeResponse(step.status, step.data);
    (response as { config: unknown }).config = config;
    if (step.status >= 400) {
      const error = new Error(`Request failed with status code ${step.status}`) as Error & {
        isAxiosError: boolean;
        response: unknown;
        config: unknown;
      };
      error.isAxiosError = true;
      error.response = response;
      error.config = config;
      throw error;
    }
    return response;
  };
  return calls;
}

describe("apiError helpers", () => {
  it("maps statuses to failure kinds", () => {
    const failure = normalizeApiError({
      isAxiosError: true,
      response: { status: 429, data: { error: "Too many write requests." }, headers: { "retry-after": "3" } }
    });

    expect(failure.kind).toBe("rate_limited");
    expect(failure.serverMessage).toBe("Too many write requests.");
    expect(failure.retryAfterMs).toBe(3000);
    expect(failure.retriable).toBe(true);
  });

  it("falls back to plain language for transport failures", () => {
    expect(normalizeApiError({ code: "ECONNABORTED" }).message).toMatch(/took too long/i);
    expect(normalizeApiError({ request: {} }).message).toMatch(/could not reach the server/i);
    expect(normalizeApiError({ code: "ERR_CANCELED" }).kind).toBe("canceled");
  });

  it("reports offline when the browser has no connection", () => {
    const original = Object.getOwnPropertyDescriptor(window.navigator, "onLine");
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    try {
      const failure = normalizeApiError({ request: {} });
      expect(failure.kind).toBe("offline");
      expect(failure.message).toMatch(/no connection to the server/i);
    } finally {
      if (original) {
        Object.defineProperty(window.navigator, "onLine", original);
      }
    }
  });

  it("only treats read methods as idempotent", () => {
    expect(isIdempotent({ method: "get" })).toBe(true);
    expect(isIdempotent({ method: "POST" })).toBe(false);
    expect(isIdempotent({ method: "delete" })).toBe(false);
  });

  it("backs off with jitter and honors Retry-After", () => {
    const noHeader = retryDelayMs({ response: { status: 503, headers: {} } }, 0);
    expect(noHeader).toBeGreaterThanOrEqual(400);
    expect(noHeader).toBeLessThan(520);

    const withHeader = retryDelayMs({ response: { status: 429, headers: { "retry-after": "2" } } }, 3);
    expect(withHeader).toBe(2000);
  });

  it("refuses to retry writes and aborted requests", () => {
    const serverError = { response: { status: 500, headers: {} } };
    expect(shouldRetryRequest(serverError, 0, { method: "get" })).toBe(true);
    expect(shouldRetryRequest(serverError, 0, { method: "post" })).toBe(false);
    expect(shouldRetryRequest(serverError, 0, { method: "get", signal: { aborted: true } })).toBe(false);
    expect(shouldRetryRequest(serverError, 2, { method: "get" })).toBe(false);
    expect(shouldRetryRequest({ response: { status: 404, headers: {} } }, 0, { method: "get" })).toBe(false);
  });
});

describe("api client hardening", () => {
  const originalAdapter = api.defaults.adapter;

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
  });

  it("retries a read after a server error", async () => {
    const calls = installAdapter([
      { status: 503, data: { success: false, error: "temporarily unavailable" } },
      { status: 200, data: { success: true, data: { ok: true }, error: null } }
    ]);

    const result = await api.get("/api/v1/processes");

    expect(calls).toHaveLength(2);
    expect(calls[1]._retryCount).toBe(1);
    expect(result.data.success).toBe(true);
  }, 15_000);

  it("does not retry a write", async () => {
    const calls = installAdapter([{ status: 500, data: { success: false, error: "boom" } }]);

    await expect(api.post("/api/v1/processes/api/restart")).rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("does not retry client errors", async () => {
    const calls = installAdapter([{ status: 404, data: { success: false, error: "missing" } }]);

    await expect(api.get("/api/v1/processes/nope")).rejects.toBeTruthy();
    expect(calls).toHaveLength(1);
  });

  it("gives up after the retry budget is spent", async () => {
    const calls = installAdapter([
      { status: 500, data: {} },
      { status: 500, data: {} },
      { status: 500, data: {} }
    ]);

    await expect(api.get("/api/v1/processes")).rejects.toBeTruthy();
    expect(calls).toHaveLength(3);
  }, 15_000);
});

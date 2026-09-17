import { AxiosError, type AxiosRequestConfig } from "axios";

export type ApiFailureKind =
  | "offline"
  | "timeout"
  | "rate_limited"
  | "auth"
  | "forbidden"
  | "not_found"
  | "validation"
  | "server"
  | "network"
  | "canceled"
  | "unknown";

export type ApiFailure = {
  kind: ApiFailureKind;
  status: number | null;
  message: string;
  /** Server-provided message, when it is safe to show. */
  serverMessage: string | null;
  retryAfterMs: number | null;
  requestId: string | null;
  retriable: boolean;
};

const DEFAULT_MESSAGES: Record<ApiFailureKind, string> = {
  offline: "No connection to the server. Check your network, then retry.",
  timeout: "The server took too long to respond. It may still be working, retry in a moment.",
  rate_limited: "Too many requests. Wait a few seconds, then retry.",
  auth: "Your session expired. Sign in again to continue.",
  forbidden: "You do not have permission to do that.",
  not_found: "That item no longer exists. Refresh to see the current state.",
  validation: "Some values were rejected. Check the highlighted fields.",
  server: "The server hit a problem. Retry, and check the server log if it repeats.",
  network: "Could not reach the server. Check the connection and retry.",
  canceled: "Request canceled.",
  unknown: "Something went wrong. Retry, and check the server log if it repeats."
};

function parseRetryAfter(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  const date = Date.parse(text);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }
  return null;
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function statusToKind(status: number): ApiFailureKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "validation";
  return "unknown";
}

export function normalizeApiError(error: unknown): ApiFailure {
  const axiosError = error as AxiosError | undefined;
  const status = axiosError?.response?.status ?? null;
  const data = axiosError?.response?.data as { error?: unknown; requestId?: unknown } | undefined;
  const serverMessage = typeof data?.error === "string" && data.error.trim() ? data.error.trim() : null;
  const requestId = typeof data?.requestId === "string" && data.requestId.trim() ? data.requestId.trim() : null;
  const retryAfterMs = parseRetryAfter(
    axiosError?.response?.headers?.["retry-after"] ?? axiosError?.response?.headers?.["Retry-After"]
  );

  let kind: ApiFailureKind;
  if (axiosError?.code === "ERR_CANCELED") {
    kind = "canceled";
  } else if (axiosError?.code === "ECONNABORTED" || axiosError?.code === "ETIMEDOUT") {
    kind = "timeout";
  } else if (status) {
    kind = statusToKind(status);
  } else if (isBrowserOffline()) {
    kind = "offline";
  } else if (axiosError?.request) {
    kind = "network";
  } else {
    kind = "unknown";
  }

  // 5xx and 429 responses can be safe to retry; 4xx cannot.
  const retriable = kind === "server" || kind === "rate_limited" || kind === "timeout" || kind === "network" || kind === "offline";

  return {
    kind,
    status,
    message: kind === "canceled" ? DEFAULT_MESSAGES.canceled : serverMessage || DEFAULT_MESSAGES[kind],
    serverMessage,
    retryAfterMs,
    requestId,
    retriable
  };
}

/** True when the request is safe to send again: no response body was applied yet. */
export function isIdempotent(config: AxiosRequestConfig | undefined) {
  const method = String(config?.method || "get").toLowerCase();
  return method === "get" || method === "head" || method === "options";
}

export function shouldRetryRequest(
  error: AxiosError,
  attempt: number,
  config: AxiosRequestConfig | undefined,
  options: { maxAttempts?: number } = {}
) {
  // attempt is the number of retries already performed.
  const maxAttempts = options.maxAttempts ?? 2;
  if (attempt >= maxAttempts) {
    return false;
  }
  // Never retry a request the caller aborted, or an endpoint that is not idempotent.
  if (config?.signal?.aborted || !isIdempotent(config)) {
    return false;
  }
  return normalizeApiError(error).retriable;
}

export function retryDelayMs(error: AxiosError, attempt: number, options: { baseMs?: number; maxMs?: number } = {}) {
  const baseMs = options.baseMs ?? 400;
  const maxMs = options.maxMs ?? 8_000;
  const failure = normalizeApiError(error);
  if (failure.retryAfterMs !== null) {
    return failure.retryAfterMs;
  }
  // Exponential backoff with jitter so a fleet of dashboards does not sync up.
  const backoff = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.random() * 0.3 * backoff;
  return Math.round(backoff + jitter);
}

export function describeApiError(error: unknown) {
  return normalizeApiError(error).message;
}

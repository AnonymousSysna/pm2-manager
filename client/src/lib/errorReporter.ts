import type { ErrorInfo } from "react";

export type ClientErrorKind = "error" | "unhandledrejection" | "react" | "resource";

export type ClientErrorInput = {
  message: string;
  kind?: ClientErrorKind;
  name?: string;
  stack?: string;
  componentStack?: string;
  source?: string;
  severity?: "error" | "warning";
  extra?: Record<string, unknown>;
};

export type ClientErrorPayload = {
  kind: ClientErrorKind;
  message: string;
  name?: string;
  stack?: string;
  componentStack?: string;
  source?: string;
  severity: "error" | "warning";
  extra?: Record<string, unknown>;
  route: string;
  url: string;
  userAgent: string;
  release: string;
  sessionId: string;
};

type ReporterOptions = {
  send: (payload: ClientErrorPayload) => void;
  enabled: boolean;
  now?: () => number;
  maxReportsPerSession?: number;
  dedupeWindowMs?: number;
  maxSendsPerBurst?: number;
  burstWindowMs?: number;
  bufferSize?: number;
  environment?: () => Pick<ClientErrorPayload, "route" | "url" | "userAgent" | "release" | "sessionId">;
};

const DEFAULT_ENVIRONMENT = () => ({
  route: typeof window === "undefined" ? "" : window.location.pathname,
  url: typeof window === "undefined" ? "" : window.location.href,
  userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  release: String((import.meta.env.VITE_APP_VERSION as string | undefined) || ""),
  sessionId: ""
});

export function isErrorReportingEnabled() {
  const configured = String(import.meta.env.VITE_ERROR_REPORTING ?? "").trim().toLowerCase();
  if (configured) {
    return ["1", "true", "on", "yes"].includes(configured);
  }
  // Self-hosted default: report to our own server in production, stay silent in dev.
  return Boolean(import.meta.env.PROD);
}

function getSessionId() {
  const key = "pm2_client_error_session";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) {
      return existing;
    }
    const created = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s${Date.now().toString(36)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch (_error) {
    return "";
  }
}

export function fingerprintReport(input: ClientErrorInput) {
  const firstFrame = String(input.stack || "")
    .split("\n")
    .slice(1, 4)
    .join("|");
  return [input.kind || "error", input.message, input.source || "", firstFrame].join("::");
}

function errorToInput(error: unknown, fallbackMessage = "Unknown client error"): ClientErrorInput {
  if (error instanceof Error) {
    return { message: error.message || fallbackMessage, name: error.name, stack: error.stack };
  }
  if (typeof error === "string" && error.trim()) {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch (_error) {
    return { message: fallbackMessage };
  }
}

export function createErrorReporter(options: ReporterOptions) {
  const {
    send,
    enabled,
    now = () => Date.now(),
    maxReportsPerSession = 25,
    dedupeWindowMs = 60_000,
    maxSendsPerBurst = 5,
    burstWindowMs = 10_000,
    bufferSize = 20,
    environment = DEFAULT_ENVIRONMENT
  } = options;

  const seen = new Map<string, { count: number; lastSentAt: number }>();
  const buffer: Array<{ at: number; input: ClientErrorInput }> = [];
  let sessionSends = 0;
  let burst: number[] = [];
  let installed = false;

  function remember(input: ClientErrorInput) {
    buffer.push({ at: now(), input });
    while (buffer.length > bufferSize) {
      buffer.shift();
    }
  }

  function report(input: ClientErrorInput) {
    if (!input?.message) {
      return null;
    }
    remember(input);
    if (!enabled) {
      return null;
    }

    const fingerprint = fingerprintReport(input);
    const timestamp = now();
    const previous = seen.get(fingerprint);
    if (previous && timestamp - previous.lastSentAt < dedupeWindowMs) {
      // Same crash from the same frame: bump the counter without another network write.
      previous.count += 1;
      return fingerprint;
    }

    burst = burst.filter((value) => timestamp - value < burstWindowMs);
    if (sessionSends >= maxReportsPerSession || burst.length >= maxSendsPerBurst) {
      return fingerprint;
    }

    seen.set(fingerprint, { count: (previous?.count || 0) + 1, lastSentAt: timestamp });
    sessionSends += 1;
    burst.push(timestamp);

    const env = environment();
    send({
      kind: input.kind || "error",
      message: input.message,
      name: input.name,
      stack: input.stack,
      componentStack: input.componentStack,
      source: input.source,
      severity: input.severity || "error",
      extra: input.extra,
      route: env.route,
      url: env.url,
      userAgent: env.userAgent,
      release: env.release,
      sessionId: env.sessionId || getSessionId()
    });
    return fingerprint;
  }

  function reportError(error: unknown, context: Partial<ClientErrorInput> = {}) {
    return report({ ...errorToInput(error), ...context });
  }

  function reportReactError(error: unknown, info?: ErrorInfo, context: Partial<ClientErrorInput> = {}) {
    return report({
      ...errorToInput(error, "React render error"),
      kind: "react",
      componentStack: info?.componentStack || undefined,
      ...context
    });
  }

  function install() {
    if (installed || typeof window === "undefined") {
      return;
    }
    installed = true;

    window.addEventListener("error", (event) => {
      // Resource load failures bubble without an error object.
      if (!event.error && event.target && event.target !== window) {
        const target = event.target as HTMLElement;
        report({
          kind: "resource",
          message: `Failed to load ${target.tagName?.toLowerCase() || "resource"}`,
          source: (target as HTMLImageElement).src || (target as HTMLLinkElement).href || ""
        });
        return;
      }
      reportError(event.error || event.message, {
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
      });
    });

    window.addEventListener("unhandledrejection", (event) => {
      report({ ...errorToInput(event.reason, "Unhandled promise rejection"), kind: "unhandledrejection" });
    });
  }

  return {
    report,
    reportError,
    reportReactError,
    install,
    getBuffer: () => buffer.map((entry) => ({ ...entry })),
    reset() {
      seen.clear();
      buffer.length = 0;
      burst = [];
      sessionSends = 0;
    }
  };
}

function sendWithKeepAlive(payload: ClientErrorPayload) {
  try {
    void fetch("/api/v1/client-errors", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch (_error) {
    // Reporting must never surface a second failure to the user.
  }
}

export const errorReporter = createErrorReporter({
  send: sendWithKeepAlive,
  enabled: isErrorReportingEnabled()
});

export const installGlobalErrorReporting = () => errorReporter.install();
export const reportClientError = (input: ClientErrorInput) => errorReporter.report(input);

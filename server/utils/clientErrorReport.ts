const { sanitizeMeta } = require("./logger");
const { scrubUrl, redactSecretsFromText } = require("./urlSafety");

const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 8000;
const MAX_SHORT_FIELD = 200;
const MAX_URL_LENGTH = 500;
const MAX_REPORTS = 100;
const MAX_STRING_FIELD = Number.isFinite(Number(process.env.LOG_FIELD_MAX_LENGTH))
  ? Math.max(200, Math.floor(Number(process.env.LOG_FIELD_MAX_LENGTH)))
  : 2000;

const KINDS = new Set(["error", "unhandledrejection", "react", "resource"]);

function clamp(value, max) {
  const text = String(value == null ? "" : value);
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...[truncated]`;
}

function cleanText(value, max, { scrub = true } = {}) {
  const redacted = scrub ? redactSecretsFromText(value) : String(value == null ? "" : value);
  return clamp(redacted.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim(), max);
}

// Client stacks often contain the reporter's own frames plus minified bundle noise.
// Keep the message + first frames, which is what actually identifies the bug.
function trimStack(value) {
  const stack = cleanText(value, MAX_STACK_LENGTH);
  if (!stack) {
    return "";
  }
  return stack
    .split("\n")
    .slice(0, 40)
    .join("\n");
}

function sanitizeClientErrorReport(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Report body must be an object" };
  }

  const message = cleanText(body.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    return { ok: false, error: "message is required" };
  }

  const kind = String(body.kind || "error").trim().toLowerCase();
  const report = {
    kind: KINDS.has(kind) ? kind : "error",
    message,
    name: cleanText(body.name, MAX_SHORT_FIELD),
    stack: trimStack(body.stack),
    componentStack: trimStack(body.componentStack),
    source: cleanText(body.source, MAX_SHORT_FIELD),
    url: clamp(scrubUrl(body.url), MAX_URL_LENGTH),
    userAgent: cleanText(body.userAgent, 400, { scrub: false }),
    release: cleanText(body.release, MAX_SHORT_FIELD, { scrub: false }),
    sessionId: cleanText(body.sessionId, 64, { scrub: false }).replace(/[^A-Za-z0-9._-]/g, ""),
    route: cleanText(body.route, MAX_SHORT_FIELD),
    severity: String(body.severity || "error").trim().toLowerCase() === "warning" ? "warning" : "error",
    extra: sanitizeMeta(body.extra && typeof body.extra === "object" ? body.extra : {})
  };

  // Keep the payload bounded even if an extra object smuggles long strings in.
  if (JSON.stringify(report).length > MAX_STRING_FIELD * 4) {
    report.extra = {};
  }

  return { ok: true, value: report };
}

function buildFingerprint(report) {
  const frame = String(report.stack || "")
    .split("\n")
    .slice(1)
    .map((line) => cleanText(line, 160))
    .slice(0, 3)
    .join("|");
  return [report.kind, report.message, report.source, frame].filter(Boolean).join("::");
}

function createClientErrorStore({ max = MAX_REPORTS } = {}) {
  /** @type {Map<string, any>} */
  const entries = new Map();

  return {
    record(report, meta) {
      const fingerprint = buildFingerprint(report);
      const ip = meta?.ip ? String(meta.ip) : "";
      const existing = entries.get(fingerprint);
      if (existing) {
        existing.count += 1;
        existing.lastSeen = Date.now();
        if (ip) {
          existing.ips = Array.from(new Set([...existing.ips, ip])).slice(-5);
        }
        return { entry: existing, fingerprint, duplicate: true };
      }

      const entry = {
        fingerprint,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        ips: ip ? [ip] : [],
        report
      };
      entries.set(fingerprint, entry);
      while (entries.size > max) {
        entries.delete(entries.keys().next().value);
      }
      return { entry, fingerprint, duplicate: false };
    },

    list() {
      return Array.from(entries.values()).sort((a, b) => b.lastSeen - a.lastSeen);
    },

    size() {
      return entries.size;
    },

    clear() {
      entries.clear();
    }
  };
}

function publicReport(entry) {
  return {
    fingerprint: entry.fingerprint,
    count: entry.count,
    firstSeen: entry.firstSeen,
    lastSeen: entry.lastSeen,
    report: entry.report
  };
}

module.exports = {
  MAX_REPORTS,
  buildFingerprint,
  createClientErrorStore,
  publicReport,
  sanitizeClientErrorReport
};

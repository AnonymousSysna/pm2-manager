const { normalizeOrigin } = require("../utils/urlSafety");

const DEFAULT_PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "autoplay=()",
  "battery=()",
  "camera=()",
  "display-capture=()",
  "document-domain=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "usb=()",
  "web-share=()",
  "xr-spatial-tracking=()"
].join(", ");

function toWebSocketOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

function parseAllowedOrigins() {
  return String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function buildContentSecurityPolicy() {
  const allowedOrigins = parseAllowedOrigins();
  const socketOrigins = allowedOrigins.map(toWebSocketOrigin).filter(Boolean);
  const connectSources = Array.from(new Set(["'self'", ...allowedOrigins, ...socketOrigins]));

  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:"
  ].join("; ");
}

function shouldUseHsts(req) {
  const override = String(process.env.SECURITY_HSTS || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(override)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(override)) {
    return false;
  }

  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return forwardedProto === "https" || Boolean(req?.secure);
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", DEFAULT_PERMISSIONS_POLICY);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");

  if (process.env.NODE_ENV === "production" && String(process.env.SECURITY_CSP || "1") !== "0") {
    res.setHeader("Content-Security-Policy", buildContentSecurityPolicy());
  }

  if (process.env.NODE_ENV === "production" && shouldUseHsts(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  if (String(req.originalUrl || req.url || "").startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
}

module.exports = {
  buildContentSecurityPolicy,
  securityHeaders
};

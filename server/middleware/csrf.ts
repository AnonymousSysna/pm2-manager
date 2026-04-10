const crypto = require("crypto");
const { parseCookieHeader } = require("../utils/cookies");

const CSRF_COOKIE_NAME = "pm2_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function shouldUseSecureCookies(req) {
  const override = String(process.env.COOKIE_SECURE || "").trim().toLowerCase();
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
  if (forwardedProto) {
    return forwardedProto === "https";
  }

  return Boolean(req?.secure);
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value || "")).origin.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getRequestOrigin(req) {
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req?.headers?.host || "").trim();
  if (!host) {
    return "";
  }

  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto || (shouldUseSecureCookies(req) ? "https" : "http");
  return normalizeOrigin(`${protocol}://${host}`);
}

function getCookieSameSite(req) {
  const override = String(process.env.COOKIE_SAME_SITE || "").trim().toLowerCase();
  if (override === "strict") {
    return "strict";
  }
  if (override === "none") {
    return "none";
  }
  if (override === "lax") {
    return "lax";
  }

  const requestOrigin = getRequestOrigin(req);
  const callerOrigin = normalizeOrigin(req?.headers?.origin || "");
  if (callerOrigin && requestOrigin && callerOrigin !== requestOrigin && shouldUseSecureCookies(req)) {
    return "none";
  }

  return "lax";
}

function setCsrfCookie(res, req) {
  const secureCookie = shouldUseSecureCookies(req);
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: secureCookie,
    sameSite: getCookieSameSite(req),
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  });
  return token;
}

function verifyCsrf(req, res, next) {
  const method = String(req.method || "").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    next();
    return;
  }

  const path = String(req.path || req.originalUrl || "");
  if (path.endsWith("/auth/login") || path.endsWith("/auth/refresh")) {
    next();
    return;
  }

  const cookies = parseCookieHeader(req.headers.cookie || "");
  const cookieToken = String(cookies[CSRF_COOKIE_NAME] || "");
  const headerToken = String(req.headers[CSRF_HEADER_NAME] || "");

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({
      success: false,
      data: null,
      error: "Invalid CSRF token"
    });
    return;
  }

  next();
}

module.exports = {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  getCookieSameSite,
  shouldUseSecureCookies,
  setCsrfCookie,
  verifyCsrf
};


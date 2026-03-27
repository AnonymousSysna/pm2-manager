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

function setCsrfCookie(res, req) {
  const secureCookie = shouldUseSecureCookies(req);
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: secureCookie,
    sameSite: "lax",
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
  if (path.endsWith("/auth/login")) {
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
  shouldUseSecureCookies,
  setCsrfCookie,
  verifyCsrf
};

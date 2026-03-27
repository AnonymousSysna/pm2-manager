const jwt = require("jsonwebtoken");
const { isIpAllowed, getRequestIp } = require("../utils/ipAccess");
const { parseCookieHeader } = require("../utils/cookies");

const AUTH_COOKIE_NAME = "pm2_session";

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme === "Bearer" && token) {
    return token;
  }

  const cookies = parseCookieHeader(req.headers.cookie || "");
  return cookies[AUTH_COOKIE_NAME] || "";
}

function verifyToken(req, res, next) {
  const ip = getRequestIp(req);
  if (!isIpAllowed(ip)) {
    return res
      .status(403)
      .json({ success: false, data: null, error: "Access denied for this IP" });
  }

  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    return res
      .status(503)
      .json({ success: false, data: null, error: "Server auth misconfigured" });
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, data: null, error: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    return next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, data: null, error: "Invalid token" });
  }
}

module.exports = { verifyToken, getTokenFromRequest, AUTH_COOKIE_NAME };

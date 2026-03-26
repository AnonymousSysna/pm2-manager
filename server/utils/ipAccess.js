function normalizeIp(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }

  const first = value.split(",")[0].trim();
  if (first.startsWith("::ffff:")) {
    return first.slice(7);
  }
  return first;
}

function getAllowedIps() {
  const raw = String(process.env.AUTH_ALLOWED_IPS || "").trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => normalizeIp(item))
    .filter(Boolean);
}

function isIpAllowed(ip) {
  const allowed = getAllowedIps();
  if (allowed.length === 0) {
    return true;
  }
  const normalized = normalizeIp(ip);
  return normalized ? allowed.includes(normalized) : false;
}

function getRequestIp(req) {
  return normalizeIp(req.ip || req.socket?.remoteAddress || "");
}

function getSocketIp(socket) {
  const trustProxy = String(process.env.TRUST_PROXY || "").trim() === "1";
  if (trustProxy) {
    const fwd = socket.handshake?.headers?.["x-forwarded-for"];
    const normalized = normalizeIp(fwd);
    if (normalized) {
      return normalized;
    }
  }
  return normalizeIp(socket.handshake?.address || "");
}

module.exports = {
  normalizeIp,
  getAllowedIps,
  isIpAllowed,
  getRequestIp,
  getSocketIp
};

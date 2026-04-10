function getClientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  const cleanupIntervalMs = Math.max(15_000, Math.min(60_000, Math.floor(windowMs / 2)));
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits.entries()) {
      if (now >= v.resetAt) {
        hits.delete(k);
      }
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${getClientIp(req)}:${req.baseUrl || ""}:${req.path || ""}:${req.method || ""}`;
    const entry = hits.get(key);

    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        success: false,
        data: null,
        error: message || "Too many requests"
      });
      return;
    }

    entry.count += 1;
    next();
  };
}

const readLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: "Too many read requests. Please retry shortly."
});

const writeLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: "Too many write requests. Please retry shortly."
});

const criticalWriteLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: "Too many critical operations. Please retry shortly."
});

module.exports = {
  createRateLimiter,
  readLimiter,
  writeLimiter,
  criticalWriteLimiter
};


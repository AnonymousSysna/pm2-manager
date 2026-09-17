const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { logger } = require("./utils/logger");
const { normalizeOrigin, scrubUrl } = require("./utils/urlSafety");
const { assertEnvironmentReady, getEnvironmentReport } = require("./utils/envGuard");
const { securityHeaders } = require("./middleware/securityHeaders");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { metricsMiddleware, renderMetrics } = require("./middleware/metrics");
const { verifyCsrf } = require("./middleware/csrf");
const { createRateLimiter } = require("./middleware/rateLimit");

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const environmentReport = assertEnvironmentReady();
if (environmentReport.warnings.length > 0) {
  logger.warn("environment_warnings", { warnings: environmentReport.warnings });
}

const processRoutes = require("./routes/processes");
const authRoutes = require("./routes/auth");
const pm2Routes = require("./routes/pm2");
const aiRoutes = require("./routes/ai");
const alertRoutes = require("./routes/alerts");
const caddyRoutes = require("./routes/caddy");
const systemRoutes = require("./routes/system");
const { registerPM2Monitor } = require("./socket/pm2Monitor");
const { isIpAllowed, getRequestIp } = require("./utils/ipAccess");
const { getPM2QueueState } = require("./utils/pm2Client");

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 8000);
const trustProxy = String(process.env.TRUST_PROXY || "").trim() === "1";
const configuredOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
const HEALTHCHECK_TIMEOUT_MS = Number.isFinite(Number(process.env.HEALTHCHECK_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.HEALTHCHECK_TIMEOUT_MS)))
  : 5000;

function isLocalDevOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized || process.env.NODE_ENV === "production") {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch (_error) {
    return false;
  }
}

function corsDeniedError(message) {
  const error = new Error(message);
  error.status = 403;
  error.expose = true;
  return error;
}

function isCorsOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  return configuredOrigins.some((allowedOrigin) => {
    const allowed = normalizeOrigin(allowedOrigin) || allowedOrigin;
    return allowed === normalized;
  }) || isLocalDevOrigin(normalized);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runHealthCommand(command, args, options = {}) {
  const cwd = options.cwd || path.resolve(__dirname, "..");
  const timeoutMs = options.timeoutMs || HEALTHCHECK_TIMEOUT_MS;

  return new Promise((resolve) => {
    let output = "";
    let finished = false;
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      windowsHide: true
    });

    const done = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      resolve({
        ok: Boolean(result.ok),
        code: result.code ?? null,
        timedOut: Boolean(result.timedOut),
        output: output.trim()
      });
    };

    const timeout = setTimeout(() => {
      try {
        child.kill();
      } catch (_error) {
        // Best effort; the process may already have exited.
      }
      done({ ok: false, timedOut: true });
    }, timeoutMs);
    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      output += error.message;
      done({ ok: false, code: null });
    });
    child.on("close", (code) => {
      done({ ok: code === 0, code });
    });
  });
}

function probePm2Health() {
  return runHealthCommand(npmCommand(), ["--prefix", "server", "exec", "pm2", "--", "jlist"], {
    cwd: path.resolve(__dirname, ".."),
    timeoutMs: HEALTHCHECK_TIMEOUT_MS
  });
}

const metricsReadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: Number.isFinite(Number(process.env.METRICS_RATE_LIMIT_MAX))
    ? Math.max(1, Math.floor(Number(process.env.METRICS_RATE_LIMIT_MAX)))
    : 20,
  message: "Too many metrics requests. Please retry shortly."
});

app.set("trust proxy", trustProxy);
app.disable("x-powered-by");

app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});
app.use(securityHeaders);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      const allowed = isCorsOriginAllowed(origin);
      callback(
        allowed ? null : corsDeniedError("CORS blocked: origin not allowed. Set CORS_ALLOWED_ORIGINS."),
        allowed
      );
    }
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(metricsMiddleware);
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    logger.info("http_request", {
      requestId: req.requestId,
      method: req.method,
      path: scrubUrl(req.originalUrl),
      status: res.statusCode,
      durationMs: Date.now() - started,
      ip: getRequestIp(req)
    });
  });
  next();
});

app.get("/health", async (_req, res) => {
  const pm2Probe = await probePm2Health();
  const payload = {
    status: pm2Probe.ok ? "ok" : "degraded",
    pm2Connected: pm2Probe.ok,
    uptime: process.uptime(),
    port: PORT,
    timestamp: Date.now(),
    pm2Queue: getPM2QueueState(),
    error: null
  };

  if (!pm2Probe.ok) {
    payload.error = pm2Probe.timedOut
      ? `PM2 health probe timed out after ${HEALTHCHECK_TIMEOUT_MS}ms`
      : pm2Probe.output || "PM2 health probe failed";
  }

  res.status(pm2Probe.ok ? 200 : 503).json(payload);
});

app.get("/ready", async (_req, res) => {
  const config = getEnvironmentReport();
  const pm2Probe = await probePm2Health();
  const ready = config.ok && pm2Probe.ok;

  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    pm2Connected: pm2Probe.ok,
    uptime: process.uptime(),
    pm2Queue: getPM2QueueState(),
    timestamp: Date.now()
  });
});

app.get("/metrics", metricsReadLimiter, (req, res) => {
  const ip = getRequestIp(req);
  if (!isIpAllowed(ip)) {
    res.status(403).json({ success: false, data: null, error: "Access denied for this IP" });
    return;
  }

  const metricsToken = String(process.env.METRICS_TOKEN || "").trim();
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (token !== metricsToken) {
    res.status(401).json({ success: false, data: null, error: "Unauthorized" });
    return;
  }

  res.set("Content-Type", "text/plain; version=0.0.4");
  res.send(renderMetrics());
});

const v1 = express.Router();
v1.use(verifyCsrf);
v1.use("/auth", authRoutes);
v1.use("/processes", processRoutes);
v1.use("/pm2", pm2Routes);
v1.use("/ai", aiRoutes);
v1.use("/alerts", alertRoutes);
v1.use("/caddy", caddyRoutes);
v1.use("/system", systemRoutes);

app.use("/api/v1", v1);
app.use("/api", v1);

const clientDistPath = path.resolve(__dirname, "../client/dist");
const clientIndexPath = path.join(clientDistPath, "index.html");

function shouldServeClientRoute(req) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const routePath = String(req.path || "");
  if (
    routePath.startsWith("/api") ||
    routePath.startsWith("/socket.io") ||
    routePath === "/health" ||
    routePath === "/ready" ||
    routePath === "/metrics"
  ) {
    return false;
  }

  const accept = String(req.headers.accept || "");
  return routePath === "/" || routePath.startsWith("/dashboard") || accept.includes("text/html");
}

if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientDistPath, { index: false }));
}

app.get("*", (req, res, next) => {
  if (!shouldServeClientRoute(req)) {
    next();
    return;
  }

  if (!fs.existsSync(clientIndexPath)) {
    next();
    return;
  }

  res.sendFile(clientIndexPath);
});

const io = new Server(server, {
  cors: {
    credentials: true,
    origin(origin, callback) {
      const allowed = isCorsOriginAllowed(origin);
      callback(
        allowed ? null : corsDeniedError("Socket CORS blocked: origin not allowed."),
        allowed
      );
    },
    methods: ["GET", "POST"]
  }
});

app.set("io", io);
registerPM2Monitor(io);
app.use(notFoundHandler);
app.use(errorHandler);

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = Math.max(310_000, Number(process.env.COMMAND_TIMEOUT_MS || 300000) + 10_000);

function shutdown(signal) {
  logger.info("server_shutdown_started", { signal });
  server.close((error) => {
    if (error) {
      logger.error("server_shutdown_failed", { signal, error: logger.serializeError(error) });
      process.exit(1);
      return;
    }
    logger.info("server_shutdown_complete", { signal });
    process.exit(0);
  });

  const forceTimer = setTimeout(() => {
    logger.error("server_shutdown_forced", { signal });
    process.exit(1);
  }, 10_000);
  if (typeof forceTimer.unref === "function") {
    forceTimer.unref();
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
  logger.error("unhandled_rejection", { error: logger.serializeError(error) });
});
process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { error: logger.serializeError(error) });
  shutdown("uncaughtException");
});

server.listen(PORT, "0.0.0.0", () => {
  logger.info("server_started", { host: "0.0.0.0", port: PORT, production: process.env.NODE_ENV === "production" });
});


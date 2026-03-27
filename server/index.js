const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");
const crypto = require("crypto");
const { logger } = require("./utils/logger");
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");
const { metricsMiddleware, renderMetrics } = require("./middleware/metrics");
const { verifyCsrf } = require("./middleware/csrf");
const pm2 = require("pm2");

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const INSECURE_DEFAULTS = new Set([
  "admin",
  "changeme",
  "dev-secret-key",
  "your-secret-key-here",
  "change-this-secret"
]);

function requireSecureEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (INSECURE_DEFAULTS.has(value)) {
    throw new Error(`Insecure value detected for ${name}. Set a strong custom value.`);
  }
  return value;
}

function hasNonEmptyEnv(name) {
  return String(process.env[name] || "").trim().length > 0;
}

requireSecureEnv("PM2_USER");
if (!hasNonEmptyEnv("PM2_PASS") && !hasNonEmptyEnv("PM2_PASS_HASH")) {
  throw new Error("Missing required environment variable: PM2_PASS or PM2_PASS_HASH");
}
if (hasNonEmptyEnv("PM2_PASS")) {
  requireSecureEnv("PM2_PASS");
}
requireSecureEnv("JWT_SECRET");
if (!hasNonEmptyEnv("METRICS_TOKEN")) {
  throw new Error("Missing required environment variable: METRICS_TOKEN");
}

const processRoutes = require("./routes/processes");
const authRoutes = require("./routes/auth");
const pm2Routes = require("./routes/pm2");
const alertRoutes = require("./routes/alerts");
const caddyRoutes = require("./routes/caddy");
const { registerPM2Monitor } = require("./socket/pm2Monitor");
const { isIpAllowed, getRequestIp } = require("./utils/ipAccess");

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 8000);
const trustProxy = String(process.env.TRUST_PROXY || "").trim() === "1";
const configuredOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

app.set("trust proxy", trustProxy);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (configuredOrigins.length === 0) {
        callback(
          new Error("CORS blocked: origin not allowed. Set CORS_ALLOWED_ORIGINS."),
          false
        );
        return;
      }
      callback(null, configuredOrigins.includes(origin));
    }
  })
);
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});
app.use(metricsMiddleware);
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    logger.info("http_request", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - started,
      ip: getRequestIp(req)
    });
  });
  next();
});

app.get("/health", (_req, res) => {
  pm2.connect((connectError) => {
    if (connectError) {
      res.status(503).json({
        status: "degraded",
        pm2Connected: false,
        uptime: process.uptime(),
        port: PORT,
        timestamp: Date.now(),
        error: connectError.message
      });
      return;
    }

    pm2.list((listError) => {
      pm2.disconnect();
      if (listError) {
        res.status(503).json({
          status: "degraded",
          pm2Connected: false,
          uptime: process.uptime(),
          port: PORT,
          timestamp: Date.now(),
          error: listError.message
        });
        return;
      }

      res.json({
        status: "ok",
        pm2Connected: true,
        uptime: process.uptime(),
        port: PORT,
        timestamp: Date.now()
      });
    });
  });
});

app.get("/metrics", (req, res) => {
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
v1.use("/alerts", alertRoutes);
v1.use("/caddy", caddyRoutes);

app.use("/api/v1", v1);
app.use("/api", v1);

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(__dirname, "../client/dist");
  app.use(express.static(distPath));

  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/socket.io/") ||
      req.path === "/health"
    ) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const io = new Server(server, {
  cors: {
    credentials: true,
    origin: configuredOrigins.length > 0 ? configuredOrigins : false,
    methods: ["GET", "POST"]
  }
});

registerPM2Monitor(io);
app.use(notFoundHandler);
app.use(errorHandler);

server.listen(PORT, "0.0.0.0", () => {
  logger.info("server_started", { host: "0.0.0.0", port: PORT });
});

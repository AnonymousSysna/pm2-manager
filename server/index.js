const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");

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

requireSecureEnv("PM2_USER");
requireSecureEnv("PM2_PASS");
requireSecureEnv("JWT_SECRET");

const processRoutes = require("./routes/processes");
const authRoutes = require("./routes/auth");
const pm2Routes = require("./routes/pm2");
const { registerPM2Monitor } = require("./socket/pm2Monitor");

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

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    port: PORT,
    timestamp: Date.now()
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/processes", processRoutes);
app.use("/api/pm2", pm2Routes);

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
    origin: configuredOrigins.length > 0 ? configuredOrigins : false,
    methods: ["GET", "POST"]
  }
});

registerPM2Monitor(io);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PM2 Dashboard running at http://0.0.0.0:${PORT}`);
});

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Server } = require("socket.io");

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const processRoutes = require("./routes/processes");
const authRoutes = require("./routes/auth");
const pm2Routes = require("./routes/pm2");
const { registerPM2Monitor } = require("./socket/pm2Monitor");

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 8000);

app.use(cors());
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
    origin: "*",
    methods: ["GET", "POST"]
  }
});

registerPM2Monitor(io);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PM2 Dashboard running at http://0.0.0.0:${PORT}`);
});

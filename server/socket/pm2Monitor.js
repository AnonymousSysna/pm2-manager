const jwt = require("jsonwebtoken");
const pm2 = require("pm2");
const { listProcesses } = require("../controllers/processController");
const { isIpAllowed, getSocketIp } = require("../utils/ipAccess");
const { parseCookieHeader } = require("../utils/cookies");
const { AUTH_COOKIE_NAME } = require("../middleware/auth");
const { logger } = require("../utils/logger");
const {
  onSocketConnected,
  onSocketDisconnected,
  onSocketError,
  trackPm2Operation
} = require("../middleware/metrics");
const { appendHistoryEntry } = require("../utils/restartHistory");
const { listProcessMeta } = require("../utils/processMetaStore");
const { appendMetricsSample } = require("../utils/metricsHistoryStore");
const { sendAlertNotifications } = require("../utils/alertNotifier");
const { appendNotification } = require("../utils/notificationStore");

let busAttached = false;
let attachInProgress = false;
let lastMetricsSampleAt = 0;

function processSignature(proc) {
  return [
    proc.id,
    proc.name,
    proc.pid,
    proc.status,
    proc.cpu,
    proc.memory,
    proc.restarts,
    proc.port,
    proc.mode
  ].join("|");
}

function indexProcesses(processes) {
  const map = new Map();
  for (const proc of processes) {
    map.set(proc.name, proc);
  }
  return map;
}

function diffProcessLists(previous, current) {
  const upserts = [];
  const removed = [];

  for (const [name, proc] of current.entries()) {
    const old = previous.get(name);
    if (!old || processSignature(old) !== processSignature(proc)) {
      upserts.push(proc);
    }
  }

  for (const name of previous.keys()) {
    if (!current.has(name)) {
      removed.push(name);
    }
  }

  return { upserts, removed };
}

function getSocketToken(socket) {
  const authToken = String(socket.handshake?.auth?.token || "").trim();
  const cookies = parseCookieHeader(socket.handshake?.headers?.cookie || "");
  const cookieToken = String(cookies[AUTH_COOKIE_NAME] || "").trim();

  if (authToken && cookieToken && authToken !== cookieToken) {
    throw new Error("Token mismatch between auth payload and cookie");
  }

  return authToken || cookieToken;
}

function registerPM2Monitor(io) {
  const sampleMetrics = async (processes, socket) => {
    const now = Date.now();
    if (now - lastMetricsSampleAt < 1000) {
      return;
    }
    lastMetricsSampleAt = now;

    try {
      const meta = await listProcessMeta();
      const alerts = await appendMetricsSample(processes, meta);
      if (alerts.length > 0) {
        const notificationPayload = await Promise.all(
          alerts.map((alert) =>
            appendNotification({
              level: alert.severity === "danger" ? "danger" : "warning",
              category: "alert",
              title: `${alert.processName} threshold alert`,
              message: `${alert.metric}=${alert.value} threshold=${alert.threshold}`,
              processName: alert.processName,
              details: alert
            }).catch(() => null)
          )
        );

        sendAlertNotifications(alerts).catch(() => {
          // Best-effort external alert delivery.
        });
        if (socket) {
          socket.emit("monitor:alerts", alerts);
          socket.emit("notifications:new", notificationPayload.filter(Boolean));
        } else {
          io.emit("monitor:alerts", alerts);
          io.emit("notifications:new", notificationPayload.filter(Boolean));
        }
      }
    } catch (_error) {
      // Best-effort metrics sampling.
    }
  };

  io.use((socket, next) => {
    const ip = getSocketIp(socket);
    if (!isIpAllowed(ip)) {
      next(new Error("Unauthorized: IP not allowed"));
      return;
    }

    const secret = String(process.env.JWT_SECRET || "").trim();
    if (!secret) {
      next(new Error("Unauthorized: server auth misconfigured"));
      return;
    }

    let token = "";
    try {
      token = getSocketToken(socket);
    } catch (_error) {
      next(new Error("Unauthorized: token mismatch"));
      return;
    }
    if (!token) {
      next(new Error("Unauthorized: missing token"));
      return;
    }

    try {
      const decoded = jwt.verify(token, secret);
      socket.user = decoded;
      next();
    } catch (_error) {
      next(new Error("Unauthorized: invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    let previous = new Map();

    const sendInitial = async () => {
      const result = await listProcesses();
      if (result.success) {
        previous = indexProcesses(result.data);
        socket.emit("processes:update", result.data);
        await sampleMetrics(result.data, socket);
        return;
      }
      socket.emit("monitor:error", { message: result.error || "Failed to load process list" });
    };

    const sendDelta = async () => {
      const result = await listProcesses();
      if (!result.success) {
        trackPm2Operation("socket.listProcesses", false);
        socket.emit("monitor:error", { message: result.error || "Failed to refresh process list" });
        return;
      }
      trackPm2Operation("socket.listProcesses", true);

      const current = indexProcesses(result.data);
      const delta = diffProcessLists(previous, current);
      previous = current;

      if (delta.upserts.length > 0 || delta.removed.length > 0) {
        socket.emit("processes:delta", delta);
      }
      await sampleMetrics(result.data, socket);
    };

    await sendInitial();

    const requested = Number(socket.handshake?.query?.interval || 2000);
    const intervalMs = Number.isFinite(requested)
      ? Math.min(15000, Math.max(1000, Math.floor(requested)))
      : 2000;
    const timer = setInterval(sendDelta, intervalMs);
    onSocketConnected();

    socket.on("disconnect", () => {
      clearInterval(timer);
      onSocketDisconnected();
    });

    socket.on("error", () => {
      onSocketError();
    });
  });

  if (!busAttached && !attachInProgress) {
    attachInProgress = true;
    pm2.connect((connectError) => {
      if (connectError) {
        attachInProgress = false;
        logger.error("pm2_monitor_connect_failed", { error: connectError.message });
        onSocketError();
        return;
      }

      pm2.launchBus((error, bus) => {
        if (error) {
          attachInProgress = false;
          logger.error("pm2_monitor_bus_launch_failed", { error: error.message });
          onSocketError();
          return;
        }

        busAttached = true;
        attachInProgress = false;

        const onOut = (packet) => {
          io.emit("process:log", {
            processName: packet.process?.name,
            type: "stdout",
            data: packet.data,
            timestamp: Date.now()
          });
        };

        const onErr = (packet) => {
          const payload = {
            processName: packet.process?.name,
            type: "stderr",
            data: packet.data,
            timestamp: Date.now()
          };

          io.emit("process:log", payload);
          io.emit("process:exception", payload);
        };

        bus.on("log:out", onOut);
        bus.on("pm2:log:out", onOut);
        bus.on("log:err", onErr);
        bus.on("pm2:log:err", onErr);
        bus.on("process:event", async (packet) => {
          const event = String(packet?.event || "").trim();
          const processName = packet?.process?.name || packet?.process?.pm2_env?.name || null;
          if (!processName || !event) {
            return;
          }
          if (!["restart", "exit", "online", "stop"].includes(event)) {
            return;
          }

          try {
            await appendHistoryEntry({
              processName,
              event,
              source: "pm2-bus"
            });
            const notification = await appendNotification({
              level: event === "exit" ? "warning" : "info",
              category: "lifecycle",
              title: `${processName} ${event}`,
              message: `PM2 reported ${event} for ${processName}`,
              processName,
              details: {
                source: "pm2-bus",
                event
              }
            });
            io.emit("notifications:new", [notification]);
          } catch (_error) {
            // Best-effort history append.
          }
        });
        bus.on("error", (busError) => {
          logger.error("pm2_monitor_bus_error", { error: busError?.message || String(busError) });
          onSocketError();
          io.emit("monitor:error", {
            message: busError?.message || "PM2 bus error"
          });
        });
      });
    });
  }
}

module.exports = { registerPM2Monitor };

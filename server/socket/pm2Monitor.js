const jwt = require("jsonwebtoken");
const pm2 = require("pm2");
const { listProcesses } = require("../controllers/processController");
const { isIpAllowed, getSocketIp } = require("../utils/ipAccess");

let busAttached = false;

function registerPM2Monitor(io) {
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

    const token = socket.handshake?.auth?.token;
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
    const sendProcesses = async () => {
      const result = await listProcesses();
      if (result.success) {
        socket.emit("processes:update", result.data);
      }
    };

    await sendProcesses();

    const requested = Number(socket.handshake?.query?.interval || 2000);
    const intervalMs = Number.isFinite(requested)
      ? Math.min(15000, Math.max(1000, Math.floor(requested)))
      : 2000;
    const timer = setInterval(sendProcesses, intervalMs);

    socket.on("disconnect", () => {
      clearInterval(timer);
    });
  });

  if (!busAttached) {
    pm2.connect((connectError) => {
      if (connectError) {
        return;
      }

      pm2.launchBus((error, bus) => {
        if (error) {
          return;
        }

        busAttached = true;

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
      });
    });
  }
}

module.exports = { registerPM2Monitor };

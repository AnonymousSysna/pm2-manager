const jwt = require("jsonwebtoken");
const pm2 = require("pm2");
const { listProcesses } = require("../controllers/processController");

let busAttached = false;

function registerPM2Monitor(io) {
  io.use((socket, next) => {
    const token = socket.handshake?.auth?.token;
    if (!token) {
      next(new Error("Unauthorized: missing token"));
      return;
    }

    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "dev-secret-key"
      );
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

    const intervalMs = Number(socket.handshake?.query?.interval || 2000);
    const timer = setInterval(sendProcesses, intervalMs > 0 ? intervalMs : 2000);

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

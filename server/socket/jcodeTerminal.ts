const { createJcodeTerminalProcess } = require("../utils/jcodeManager.js");
const { logger } = require("../utils/logger");

const MAX_INPUT_CHARS = 12000;
const sessions = new Map();

function normalizeInput(value) {
  return String(value || "").slice(0, MAX_INPUT_CHARS);
}

function normalizeSize(value, fallback, min, max) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(normalized)));
}

function emitSessionStatus(socket, session = null) {
  socket.emit("jcode:terminal:status", {
    running: Boolean(session),
    pid: session?.pid || null,
    pty: Boolean(session?.pty),
    command: session?.command || null,
    cwd: session?.cwd || null,
    socketPath: session?.socketPath || null,
    rows: session?.rows || null,
    cols: session?.cols || null,
    mode: session?.mode || null,
    customCommand: Boolean(session?.customCommand),
    operator: session?.operator || null,
    startedAt: session?.startedAt || null
  });
}

function stopSession(socket, reason = "stopped") {
  const session = sessions.get(socket.id);
  if (!session) {
    emitSessionStatus(socket, null);
    return false;
  }

  sessions.delete(socket.id);
  try {
    if (!session.child.killed) {
      session.child.kill("SIGTERM");
      setTimeout(() => {
        try {
          if (!session.child.killed) {
            session.child.kill("SIGKILL");
          }
        } catch (_error) {
          // Best-effort cleanup.
        }
      }, 1500).unref?.();
    }
  } catch (_error) {
    // Process may already be gone.
  }

  socket.emit("jcode:terminal:exit", {
    code: null,
    signal: reason,
    timestamp: Date.now()
  });
  emitSessionStatus(socket, null);
  return true;
}

function registerJcodeTerminal(io) {
  io.on("connection", (socket) => {
    socket.on("jcode:terminal:start", async (payload = {}) => {
      const existing = sessions.get(socket.id);
      if (existing) {
        emitSessionStatus(socket, existing);
        return;
      }

      const rows = normalizeSize(payload?.rows, 30, 12, 80);
      const cols = normalizeSize(payload?.cols, 100, 40, 240);
      const result = await createJcodeTerminalProcess({
        ...payload,
        rows,
        cols
      });

      if (!result.success || !result.child) {
        socket.emit("jcode:terminal:error", {
          error: result.error || "Unable to start JCode session",
          timestamp: Date.now()
        });
        emitSessionStatus(socket, null);
        return;
      }

      const child = result.child;
      const meta = result.meta || {};
      const session = {
        child,
        pid: meta.pid || child.pid,
        pty: Boolean(meta.pty),
        command: meta.command || "jcode",
        cwd: meta.cwd || null,
        socketPath: meta.socketPath || null,
        rows: meta.rows || rows,
        cols: meta.cols || cols,
        mode: meta.mode || null,
        customCommand: Boolean(meta.customCommand),
        operator: meta.operator || null,
        startedAt: Date.now()
      };
      sessions.set(socket.id, session);

      if (meta.prelude) {
        socket.emit("jcode:terminal:output", {
          stream: "system",
          data: `${meta.prelude}\n`,
          timestamp: Date.now()
        });
      }
      socket.emit("jcode:terminal:output", {
        stream: "system",
        data: `Connected to ${session.command}${session.pty ? " through a server PTY" : ""}.\n`,
        timestamp: Date.now()
      });
      emitSessionStatus(socket, session);

      child.stdout?.on("data", (chunk) => {
        socket.emit("jcode:terminal:output", {
          stream: "stdout",
          data: chunk.toString("utf8"),
          timestamp: Date.now()
        });
      });

      child.stderr?.on("data", (chunk) => {
        socket.emit("jcode:terminal:output", {
          stream: "stderr",
          data: chunk.toString("utf8"),
          timestamp: Date.now()
        });
      });

      child.on("error", (error) => {
        logger.error("jcode_terminal_error", { error: error?.message || String(error) });
        socket.emit("jcode:terminal:error", {
          error: error?.message || "JCode terminal error",
          timestamp: Date.now()
        });
      });

      child.on("close", (code, signal) => {
        const current = sessions.get(socket.id);
        if (current?.child === child) {
          sessions.delete(socket.id);
        }
        socket.emit("jcode:terminal:exit", {
          code,
          signal,
          timestamp: Date.now()
        });
        emitSessionStatus(socket, null);
      });
    });

    socket.on("jcode:terminal:input", (payload = {}) => {
      const session = sessions.get(socket.id);
      const data = normalizeInput(payload?.data);
      if (!session || !data) {
        return;
      }
      try {
        session.child.stdin?.write(data);
      } catch (error) {
        socket.emit("jcode:terminal:error", {
          error: error?.message || "Unable to send input to JCode",
          timestamp: Date.now()
        });
      }
    });

    socket.on("jcode:terminal:resize", (payload = {}) => {
      const session = sessions.get(socket.id);
      if (!session) {
        return;
      }
      // The lightweight PTY wrapper cannot resize after spawn, but keeping the event
      // means the browser side can grow without breaking the live session.
      session.rows = normalizeSize(payload?.rows, 30, 12, 80);
      session.cols = normalizeSize(payload?.cols, 100, 40, 240);
    });

    socket.on("jcode:terminal:stop", () => {
      stopSession(socket, "manual-stop");
    });

    socket.on("disconnect", () => {
      stopSession(socket, "socket-disconnect");
    });
  });
}

module.exports = { registerJcodeTerminal };

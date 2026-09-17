const { createJcodeTerminalProcess } = require("../utils/jcodeManager.js");
const { logger } = require("../utils/logger");

const MAX_INPUT_CHARS = 12000;
const sessions = new Map();

// PTY payloads are already CRLF-terminated, but bridge/system lines are not, so
// every message the client renders uses explicit CRLF to stay column aligned.
function toTerminalText(value) {
  return String(value || "").replace(/\r?\n/g, "\r\n");
}

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
    backend: session?.backend || null,
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

function emitOutput(socket, data, stream = "pty") {
  if (!data) {
    return;
  }
  socket.emit("jcode:terminal:output", {
    stream,
    data: String(data),
    timestamp: Date.now()
  });
}

function stopSession(socket, reason = "stopped") {
  const session = sessions.get(socket.id);
  if (!session) {
    emitSessionStatus(socket, null);
    return false;
  }

  sessions.delete(socket.id);

  const handle = session.handle;
  try {
    handle.kill();
    const forceKill = typeof handle.forceKill === "function"
      ? () => handle.forceKill()
      // PTY children close with the terminal; a second kill is harmless.
      : () => handle.kill();
    setTimeout(forceKill, 1500).unref?.();
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
    socket.on("jcode:terminal:start", async (payload: any = {}) => {
      const existing = sessions.get(socket.id);
      if (existing) {
        emitSessionStatus(socket, existing);
        return;
      }

      const rows = normalizeSize(payload?.rows, 30, 12, 200);
      const cols = normalizeSize(payload?.cols, 100, 20, 400);
      const result = await createJcodeTerminalProcess({
        ...payload,
        rows,
        cols
      });

      if (!result.success || !result.session) {
        socket.emit("jcode:terminal:error", {
          error: result.error || "Unable to start JCode session",
          timestamp: Date.now()
        });
        emitSessionStatus(socket, null);
        return;
      }

      const handle = result.session;
      const meta = result.meta || {};
      const session = {
        handle,
        pid: meta.pid || handle.pid,
        pty: Boolean(meta.pty),
        backend: meta.backend || handle.backend || null,
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
        emitOutput(socket, `${toTerminalText(meta.prelude)}\r\n`, "system");
      }
      emitOutput(
        socket,
        toTerminalText(
          `Connected to ${session.command} through a ${session.backend || "server"} terminal.\r\n`
        ),
        "system"
      );
      emitSessionStatus(socket, session);

      handle.onData((chunk) => {
        emitOutput(socket, chunk, "pty");
      });

      handle.onError?.((error) => {
        logger.error("jcode_terminal_error", { error: error?.message || String(error) });
        socket.emit("jcode:terminal:error", {
          error: error?.message || "JCode terminal error",
          timestamp: Date.now()
        });
      });

      handle.onExit((code, signal) => {
        const current = sessions.get(socket.id);
        if (current?.handle === handle) {
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

    socket.on("jcode:terminal:input", (payload: any = {}) => {
      const session = sessions.get(socket.id);
      const data = normalizeInput(payload?.data);
      if (!session || !data) {
        return;
      }
      session.handle.write(data);
    });

    socket.on("jcode:terminal:resize", (payload: any = {}) => {
      const session = sessions.get(socket.id);
      if (!session) {
        return;
      }
      session.rows = normalizeSize(payload?.rows, session.rows || 30, 12, 200);
      session.cols = normalizeSize(payload?.cols, session.cols || 100, 20, 400);
      session.handle.resize(session.cols, session.rows);
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

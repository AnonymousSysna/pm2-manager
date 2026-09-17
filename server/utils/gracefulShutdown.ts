/**
 * Graceful shutdown for the dashboard server.
 *
 * `server.close()` only stops accepting new connections; it waits for every open
 * one to end on its own. The dashboard holds a websocket per tab, so a plain
 * `server.close()` never completed and every PM2 restart waited out the full
 * force timer and logged `server_shutdown_forced`. Long-polling requests and
 * keep-alive sockets idle for up to 65s had the same effect.
 *
 * The order here is what makes a restart quick and clean:
 *
 *   1. close the socket connections, so the browser learns the dashboard is going
 *      away instead of holding the process open;
 *   2. `server.close()`, which stops new requests and completes once the active
 *      ones finish;
 *   3. close idle keep-alive sockets immediately, and any socket still busy after
 *      `drainMs`, so one stuck request cannot pin the process;
 *   4. exit 0 on a clean close, or 1 if the close failed or `graceMs` elapsed.
 *
 * A second signal escalates: the operator (or PM2 itself) asking twice means
 * "stop waiting", so the process exits immediately instead of queueing another
 * close attempt.
 */

export interface ClosableServer {
  close(callback: (error?: Error | null) => void): void;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ClosableIo {
  close(callback?: (error?: Error) => void): void;
}

export interface ShutdownLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  serializeError?(error: unknown): unknown;
}

export interface ShutdownTimers {
  setTimeout(handler: () => void, ms: number): { unref?: () => void };
  clearTimeout(handle: { unref?: () => void }): void;
}

export interface GracefulShutdownOptions {
  server: ClosableServer;
  /** Optional socket server; its clients are disconnected before the server closes. */
  io?: ClosableIo | null;
  logger: ShutdownLogger;
  /** Defaults to `process.exit`; injected by tests. */
  exit?: (code: number) => void;
  /** How long to wait for a clean close before exiting non-zero. */
  graceMs?: number;
  /** How long to wait before force-closing sockets that are still busy. */
  drainMs?: number;
  timers?: ShutdownTimers;
}

export interface GracefulShutdown {
  /** Idempotent per signal: the first call drains, later calls escalate. */
  handle(signal: string): void;
  isShuttingDown(): boolean;
}

const DEFAULT_GRACE_MS = 10_000;
const DEFAULT_DRAIN_MS = 4_000;

function errorFields(logger: ShutdownLogger, error: unknown): Record<string, unknown> {
  if (typeof logger.serializeError === "function") {
    return { error: logger.serializeError(error) };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

export function createGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const {
    server,
    io = null,
    logger,
    exit = (code: number) => process.exit(code),
    graceMs = DEFAULT_GRACE_MS,
    drainMs = DEFAULT_DRAIN_MS,
    timers = {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
  } = options;

  let shuttingDown = false;
  let settled = false;
  let forceTimer: { unref?: () => void } | null = null;
  let drainTimer: { unref?: () => void } | null = null;

  function finish(code: number): void {
    if (settled) {
      return;
    }
    settled = true;
    if (forceTimer) {
      timers.clearTimeout(forceTimer);
      forceTimer = null;
    }
    if (drainTimer) {
      timers.clearTimeout(drainTimer);
      drainTimer = null;
    }
    exit(code);
  }

  function unref(timer: { unref?: () => void }): { unref?: () => void } {
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return timer;
  }

  function closeSocketClients(signal: string): void {
    if (!io) {
      return;
    }
    try {
      // Disconnects every socket client and closes the engine, which is what
      // lets `server.close()` reach its callback instead of waiting for tabs to
      // go away on their own.
      io.close();
      logger.info("server_sockets_closed", { signal });
    } catch (error) {
      logger.error("server_sockets_close_failed", { signal, ...errorFields(logger, error) });
    }
  }

  function handle(signal: string): void {
    if (shuttingDown) {
      logger.warn("server_shutdown_escalated", { signal });
      finish(1);
      return;
    }
    shuttingDown = true;
    logger.info("server_shutdown_started", { signal, graceMs, drainMs });

    closeSocketClients(signal);

    if (typeof server.closeIdleConnections === "function") {
      // A keep-alive socket with no request in flight never ends on its own.
      server.closeIdleConnections();
    }

    drainTimer = unref(
      timers.setTimeout(() => {
        drainTimer = null;
        if (typeof server.closeAllConnections === "function") {
          logger.warn("server_shutdown_closing_active_connections", { signal, drainMs });
          server.closeAllConnections();
        }
      }, drainMs)
    );

    forceTimer = unref(
      timers.setTimeout(() => {
        forceTimer = null;
        logger.error("server_shutdown_forced", { signal, graceMs });
        finish(1);
      }, graceMs)
    );

    try {
      server.close((error) => {
        if (error) {
          logger.error("server_shutdown_failed", { signal, ...errorFields(logger, error) });
          finish(1);
          return;
        }
        logger.info("server_shutdown_complete", { signal });
        finish(0);
      });
    } catch (error) {
      logger.error("server_shutdown_failed", { signal, ...errorFields(logger, error) });
      finish(1);
    }
  }

  return {
    handle,
    isShuttingDown: () => shuttingDown
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { createGracefulShutdown } from "../utils/gracefulShutdown";
import type { GracefulShutdownOptions, ShutdownLogger } from "../utils/gracefulShutdown";

function last(names: string[]): string {
  return names[names.length - 1];
}

function createLogger() {
  const events: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  const logger: ShutdownLogger = {
    info: (event, fields = {}) => events.push({ level: "info", event, fields }),
    warn: (event, fields = {}) => events.push({ level: "warn", event, fields }),
    error: (event, fields = {}) => events.push({ level: "error", event, fields }),
    serializeError: (error) => (error instanceof Error ? error.message : String(error))
  };
  return {
    logger,
    events,
    names: () => events.map((entry) => entry.event)
  };
}

function createTimers() {
  const scheduled: Array<{ handler: () => void; ms: number; cleared: boolean }> = [];
  return {
    scheduled,
    timers: {
      setTimeout: (handler: () => void, ms: number) => {
        const entry = { handler, ms, cleared: false };
        scheduled.push(entry);
        return {
          unref: () => {
            // recorded for completeness; nothing to unref in a fake
          },
          cancel: () => {
            entry.cleared = true;
          }
        };
      },
      clearTimeout: (handle: { unref?: () => void }) => {
        const cancel = (handle as { cancel?: () => void }).cancel;
        if (cancel) {
          cancel();
        }
      }
    },
    fire: (index: number) => scheduled[index].handler()
  };
}

interface HarnessOptions extends Partial<GracefulShutdownOptions> {
  closeImpl?: (callback: (error?: Error | null) => void) => void;
}

function createHarness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const { logger, events, names } = createLogger();
  const { timers, scheduled, fire } = createTimers();
  const exits: number[] = [];

  const server = {
    close: (callback: (error?: Error | null) => void) => {
      order.push("server.close");
      if (options.closeImpl) {
        options.closeImpl(callback);
        return;
      }
      order.push("server.close:complete");
      callback(null);
    },
    closeIdleConnections: () => order.push("server.closeIdleConnections"),
    closeAllConnections: () => order.push("server.closeAllConnections")
  };

  const io = {
    close: () => order.push("io.close")
  };

  const shutdown = createGracefulShutdown({
    server,
    io,
    logger,
    exit: (code) => exits.push(code),
    timers,
    ...options
  });

  return { shutdown, order, events, names, scheduled, fire, exits };
}

test("a clean shutdown disconnects sockets, stops accepting, and exits 0", () => {
  const harness = createHarness();

  harness.shutdown.handle("SIGTERM");

  assert.deepEqual(harness.exits, [0]);
  assert.deepEqual(harness.order, [
    "io.close",
    "server.closeIdleConnections",
    "server.close",
    "server.close:complete"
  ]);
  assert.deepEqual(harness.names(), [
    "server_shutdown_started",
    "server_sockets_closed",
    "server_shutdown_complete"
  ]);
  assert.ok(harness.scheduled.every((entry) => entry.cleared), "timers are cleared once the close settles");
});

test("a close failure and a thrown close both exit 1", () => {
  const failed = createHarness({
    closeImpl: (callback) => callback(new Error("listen handle already closed"))
  });
  failed.shutdown.handle("SIGTERM");
  assert.deepEqual(failed.exits, [1]);
  assert.ok(failed.names().includes("server_shutdown_failed"));
  assert.equal(failed.events[2].fields.error, "listen handle already closed");

  const threw = createHarness({
    closeImpl: () => {
      throw new Error("not listening");
    }
  });
  threw.shutdown.handle("SIGTERM");
  assert.deepEqual(threw.exits, [1]);
  assert.equal(threw.events[2].fields.error, "not listening");
});

test("a close that never completes is forced after the grace period", () => {
  const harness = createHarness({ closeImpl: () => undefined, graceMs: 500, drainMs: 100 });

  harness.shutdown.handle("SIGTERM");
  assert.deepEqual(harness.exits, [], "nothing exits while the server is still draining");
  assert.equal(harness.shutdown.isShuttingDown(), true);
  assert.deepEqual(
    harness.scheduled.map((entry) => entry.ms),
    [100, 500],
    "the drain timer fires before the force timer"
  );

  harness.fire(0);
  assert.ok(harness.order.includes("server.closeAllConnections"));
  assert.deepEqual(harness.exits, [], "closing busy sockets is not itself an exit");

  harness.fire(1);
  assert.deepEqual(harness.exits, [1]);
  assert.equal(last(harness.names()), "server_shutdown_forced");
});

test("a second signal escalates instead of waiting out the grace period", () => {
  const harness = createHarness({ closeImpl: () => undefined, graceMs: 5000 });

  harness.shutdown.handle("SIGTERM");
  harness.shutdown.handle("SIGINT");

  assert.deepEqual(harness.exits, [1]);
  assert.equal(last(harness.names()), "server_shutdown_escalated");
  assert.equal(
    harness.names().filter((name) => name === "server_shutdown_started").length,
    1,
    "a repeated signal does not start a second drain"
  );
});

test("a server without the optional connection helpers still shuts down cleanly", () => {
  const order: string[] = [];
  const { logger, names } = createLogger();
  const exits: number[] = [];

  const shutdown = createGracefulShutdown({
    server: {
      close: (callback: (error?: Error | null) => void) => {
        callback(null);
      }
    },
    io: null,
    logger,
    exit: (code) => exits.push(code)
  });

  shutdown.handle("SIGINT");

  assert.deepEqual(exits, [0]);
  assert.deepEqual(order, []);
  assert.deepEqual(names(), ["server_shutdown_started", "server_shutdown_complete"]);
});

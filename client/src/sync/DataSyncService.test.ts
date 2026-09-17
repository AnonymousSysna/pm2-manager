import { DataSyncService, pollDelayFor } from "./DataSyncService";
import type { SyncTransport, TransportHandlers } from "./types";

/** A transport under test control: it hands back the handlers it was given. */
function fakeTransport() {
  const starts: number[] = [];
  let handlers: TransportHandlers | null = null;
  let stops = 0;

  const transport: SyncTransport = {
    start(next) {
      handlers = next;
      starts.push(1);
    },
    stop() {
      stops += 1;
      handlers = null;
    }
  };

  return {
    transport,
    starts,
    get stops() {
      return stops;
    },
    handlers(): TransportHandlers {
      if (!handlers) {
        throw new Error("transport was not started");
      }
      return handlers;
    }
  };
}

function buildService(overrides: Record<string, unknown> = {}) {
  const transports: ReturnType<typeof fakeTransport>[] = [];
  const list = vi.fn().mockResolvedValue({ success: true, data: [], error: null });
  let clock = 1_000;

  const service = new DataSyncService({
    pollIntervalMs: 2000,
    createTransport: (interval) => {
      const created = fakeTransport();
      (created as any).interval = interval;
      transports.push(created);
      return created.transport;
    },
    fetchProcesses: list,
    now: () => clock,
    ...overrides
  });

  return {
    service,
    transports,
    list,
    setClock: (value: number) => {
      clock = value;
    }
  };
}

describe("pollDelayFor", () => {
  it("clamps the fallback poll to 5-15s", () => {
    expect(pollDelayFor(2000)).toBe(6000);
    expect(pollDelayFor(100)).toBe(5000);
    expect(pollDelayFor(60000)).toBe(15000);
  });
});

describe("DataSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts one transport and pulls an initial snapshot on start", async () => {
    const { service, transports, list } = buildService();
    service.start();

    expect(transports).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    service.stop();
  });

  it("does not reconnect when started twice", async () => {
    const { service, transports } = buildService();
    service.start();
    service.start();
    await Promise.resolve();

    expect(transports).toHaveLength(1);
    service.stop();
  });

  it("tracks connection flags from the transport", async () => {
    const { service, transports } = buildService();
    service.start();
    const handlers = transports[0].handlers();

    handlers.onClose();
    expect(service.getState()).toMatchObject({ connected: false, reconnecting: true });

    handlers.onOpen();
    expect(service.getState()).toMatchObject({ connected: true, reconnecting: false, monitorError: "" });

    await Promise.resolve();
    service.stop();
  });

  it("merges deltas into the current list and stamps freshness", async () => {
    const { service, transports, setClock } = buildService();
    service.start();
    const handlers = transports[0].handlers();

    handlers.onSnapshot([{ name: "api" }] as any);
    setClock(5_000);
    handlers.onDelta({ upserts: [{ name: "api", cpu: 12 }, { name: "worker" }] as any, removed: [] });

    expect(service.getState().processes.map((item) => item.name)).toEqual(["api", "worker"]);
    expect(service.getState().processesUpdatedAt).toBe(5_000);

    await Promise.resolve();
    service.stop();
  });

  it("buffers logs, alerts, notifications, and create steps", async () => {
    const { service, transports } = buildService();
    service.start();
    const handlers = transports[0].handlers();

    handlers.onLog({ processName: "api", line: "hello" });
    handlers.onAlerts([{ message: "cpu high" } as any]);
    handlers.onNotifications([{ message: "deployed" } as any]);
    handlers.onCreateStep({ operationId: "op1", stepId: "s1", label: "git pull", status: "running" });
    handlers.onMonitorError("sweep failed");

    const state = service.getState();
    expect(state.logsByProcess.api).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
    expect(state.createStepEvents).toHaveLength(1);
    expect(state.monitorError).toBe("sweep failed");

    await Promise.resolve();
    service.stop();
  });

  it("notifies subscribers only when state changes", async () => {
    const { service, transports } = buildService();
    const listener = vi.fn();
    service.subscribe(listener);
    service.start();

    expect(service.getState()).toBe(service.getState());
    const before = service.getState();
    transports[0].handlers().onAlerts([{ message: "a" } as any]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getState()).not.toBe(before);

    await Promise.resolve();
    service.stop();
  });

  it("retries the fallback poll on a timer and ignores a failed poll", async () => {
    const { service, list } = buildService();
    list.mockRejectedValueOnce(new Error("network down"));
    service.start();

    await vi.advanceTimersByTimeAsync(6000);
    expect(list).toHaveBeenCalledTimes(2);
    expect(service.getState().processes).toEqual([]);

    service.stop();
  });

  it("ignores a snapshot that arrives after the service stopped", async () => {
    let resolveList: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveList = resolve;
    });
    const { service } = buildService({ fetchProcesses: () => pending });
    service.start();
    service.stop();

    resolveList({ success: true, data: [{ name: "api" }], error: null });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.getState().processes).toEqual([]);
  });

  it("reconnects with the new interval only when the poll interval changes", async () => {
    const { service, transports } = buildService();
    service.start();
    await Promise.resolve();

    service.setPollIntervalMs(2000);
    expect(transports).toHaveLength(1);

    service.setPollIntervalMs(5000);
    expect(transports).toHaveLength(2);
    expect((transports[1] as any).interval).toBe(5000);
    expect(transports[0].stops).toBe(1);

    await Promise.resolve();
    service.stop();
    expect(transports[1].stops).toBe(1);
  });

  it("stops polling after stop, so a long-lived tab cannot leak timers", async () => {
    const { service, list } = buildService();
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    const callsWhileRunning = list.mock.calls.length;

    service.stop();
    await vi.advanceTimersByTimeAsync(60000);

    expect(list.mock.calls.length).toBe(callsWhileRunning);
  });
});

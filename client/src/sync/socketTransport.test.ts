import { createSocketTransport } from "./socketTransport";
import type { TransportHandlers } from "./types";

function fakeSocket() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const managerHandlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    on: (event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    },
    disconnect: vi.fn(),
    io: {
      on: (event: string, handler: (...args: any[]) => void) => {
        managerHandlers.set(event, handler);
      }
    }
  };
  return { socket, handlers, managerHandlers };
}

function fakeHandlers() {
  return {
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onSnapshot: vi.fn(),
    onDelta: vi.fn(),
    onLog: vi.fn(),
    onAlerts: vi.fn(),
    onMonitorError: vi.fn(),
    onNotifications: vi.fn(),
    onCreateStep: vi.fn()
  } as unknown as TransportHandlers & Record<string, ReturnType<typeof vi.fn>>;
}

function buildTransport() {
  const { socket, handlers, managerHandlers } = fakeSocket();
  const socketFactory = vi.fn(() => socket);
  const transport = createSocketTransport({ url: "http://localhost:3001", pollIntervalMs: 2000, socketFactory });
  const target = fakeHandlers();
  transport.start(target);

  return { transport, socket, socketFactory, handlers, managerHandlers, target };
}

describe("createSocketTransport", () => {
  it("connects with credentials and the negotiated push interval", () => {
    const { socketFactory, socket } = buildTransport();

    expect(socketFactory).toHaveBeenCalledWith(
      "http://localhost:3001",
      expect.objectContaining({ withCredentials: true, query: { interval: "2000" } })
    );
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it("reports open, close, and reconnect attempts through one set of flags", () => {
    const { handlers, managerHandlers, target } = buildTransport();

    handlers.get("connect")?.();
    expect(target.onOpen).toHaveBeenCalled();

    handlers.get("disconnect")?.();
    handlers.get("connect_error")?.();
    for (const event of ["reconnect_attempt", "reconnect_error", "reconnect_failed"]) {
      managerHandlers.get(event)?.();
    }
    expect(target.onClose).toHaveBeenCalledTimes(5);
  });

  it("forwards a snapshot and a well-formed delta", () => {
    const { handlers, target } = buildTransport();

    handlers.get("processes:update")?.([{ name: "api" }]);
    expect(target.onSnapshot).toHaveBeenCalledWith([{ name: "api" }]);

    handlers.get("processes:delta")?.({ upserts: [{ name: "api" }], removed: ["old"] });
    expect(target.onDelta).toHaveBeenCalledWith({ upserts: [{ name: "api" }], removed: ["old"] });
  });

  it("drops malformed payloads instead of blanking the UI", () => {
    const { handlers, target } = buildTransport();

    handlers.get("processes:update")?.("nope");
    handlers.get("processes:delta")?.({ upserts: [] });
    handlers.get("processes:delta")?.({ removed: [] });
    handlers.get("process:log")?.({});
    handlers.get("monitor:alerts")?.([]);
    handlers.get("monitor:error")?.({ message: "   " });
    handlers.get("notifications:new")?.(undefined);
    handlers.get("process:create:step")?.({ operationId: "op", stepId: "s", label: "l" });

    expect(target.onSnapshot).not.toHaveBeenCalled();
    expect(target.onDelta).not.toHaveBeenCalled();
    expect(target.onLog).not.toHaveBeenCalled();
    expect(target.onAlerts).not.toHaveBeenCalled();
    expect(target.onMonitorError).not.toHaveBeenCalled();
    expect(target.onNotifications).not.toHaveBeenCalled();
    expect(target.onCreateStep).not.toHaveBeenCalled();
  });

  it("forwards logs, alerts, notifications, and normalised create steps", () => {
    const { handlers, target } = buildTransport();

    handlers.get("process:log")?.({ processName: "api", line: "hi" });
    handlers.get("monitor:alerts")?.([{ message: "cpu" }]);
    handlers.get("monitor:error")?.({ message: "sweep failed" });
    handlers.get("notifications:new")?.([{ message: "deployed" }]);
    handlers.get("process:create:step")?.({ operationId: " op ", stepId: "s1", label: " git ", status: "running" });

    expect(target.onLog).toHaveBeenCalledWith({ processName: "api", line: "hi" });
    expect(target.onAlerts).toHaveBeenCalledWith([{ message: "cpu" }]);
    expect(target.onMonitorError).toHaveBeenCalledWith("sweep failed");
    expect(target.onNotifications).toHaveBeenCalledWith([{ message: "deployed" }]);
    expect(target.onCreateStep).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op", label: "git", status: "running", stepId: "s1" })
    );
  });

  it("disconnects on stop and can be started again", () => {
    const { transport, socket, socketFactory } = buildTransport();

    transport.stop();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);

    transport.start(fakeHandlers());
    expect(socketFactory).toHaveBeenCalledTimes(2);
  });

  it("ignores a second start while already connected", () => {
    const { transport, socketFactory } = buildTransport();

    transport.start(fakeHandlers());
    expect(socketFactory).toHaveBeenCalledTimes(1);
  });
});

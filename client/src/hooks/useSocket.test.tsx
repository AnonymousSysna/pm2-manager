import { act, cleanup, render, screen } from "@testing-library/react";
import { SocketProvider, useSocket } from "./useSocket";

const ioMock = vi.fn();
const listMock = vi.fn();
const socket = {
  on: vi.fn(),
  disconnect: vi.fn(),
  io: {
    on: vi.fn()
  }
};

vi.mock("socket.io-client", () => ({
  io: (...args) => ioMock(...args)
}));

vi.mock("../api", () => ({
  processes: {
    list: (...args) => listMock(...args)
  }
}));

function Consumer() {
  const { connected } = useSocket();
  return <div>{connected ? "connected" : "disconnected"}</div>;
}

describe("SocketProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    ioMock.mockReset();
    listMock.mockReset();
    socket.on.mockReset();
    socket.disconnect.mockReset();
    socket.io.on.mockReset();
    ioMock.mockReturnValue(socket);
    listMock.mockResolvedValue({ success: true, data: [], error: null });
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("shares a single socket connection and polling loop across consumers", async () => {
    await act(async () => {
      render(
        <SocketProvider>
          <Consumer />
          <Consumer />
        </SocketProvider>
      );
      await Promise.resolve();
    });

    expect(ioMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(6000);
      await Promise.resolve();
    });

    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("tracks when process data last arrived so staleness can be shown", async () => {
    function FreshnessConsumer() {
      const { processesUpdatedAt } = useSocket();
      return <div>{processesUpdatedAt === null ? "never" : `at:${processesUpdatedAt}`}</div>;
    }

    const firstSync = Date.parse("2026-05-05T00:00:00Z");
    vi.setSystemTime(new Date(firstSync));

    await act(async () => {
      render(
        <SocketProvider>
          <FreshnessConsumer />
        </SocketProvider>
      );
      await Promise.resolve();
    });

    expect(screen.getByText(`at:${firstSync}`)).toBeInTheDocument();

    const handler = socket.on.mock.calls.find(([event]) => event === "processes:update")?.[1];
    expect(typeof handler).toBe("function");

    const pushed = Date.parse("2026-05-05T00:01:00Z");
    vi.setSystemTime(new Date(pushed));
    await act(async () => {
      handler([{ name: "api" }]);
    });

    expect(screen.getByText(`at:${pushed}`)).toBeInTheDocument();
  });
});

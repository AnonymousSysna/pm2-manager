import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Logs from "./Logs";

const listMock = vi.fn();
const logsMock = vi.fn();
const flushMock = vi.fn();
const toastErrorMock = vi.fn();

const socketState = {
  logsByProcess: {},
  processes: [
    { name: "api", status: "online", restarts: 0, pid: 101, cpu: 1, memory: 1024 },
    { name: "worker", status: "online", restarts: 0, pid: 202, cpu: 1, memory: 1024 }
  ],
  alerts: [],
  notifications: [],
  createStepEvents: [],
  monitorError: "",
  connected: true,
  reconnecting: false
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock("../hooks/useSocket", () => ({
  useSocket: () => socketState
}));

vi.mock("../api", () => ({
  processes: {
    list: (...args) => listMock(...args),
    logs: (...args) => logsMock(...args),
    flush: (...args) => flushMock(...args)
  }
}));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: {
    error: (...args) => toastErrorMock(...args),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn((promise) => promise)
  },
  getErrorMessage: (error, fallback) => error?.message || fallback
}));

describe("Logs", () => {
  beforeEach(() => {
    listMock.mockReset();
    logsMock.mockReset();
    flushMock.mockReset();
    toastErrorMock.mockReset();
    listMock.mockResolvedValue({
      success: true,
      data: [
        { name: "api" },
        { name: "worker" }
      ],
      error: null
    });
    flushMock.mockResolvedValue({ success: true, data: null, error: null });
  });

  it("ignores stale historical log responses after quick process changes", async () => {
    const requestsByName = {
      api: [],
      worker: []
    };

    logsMock.mockImplementation((name) => {
      const request = deferred();
      requestsByName[name].push(request);
      return request.promise;
    });

    render(
      <MemoryRouter initialEntries={["/dashboard/logs"]}>
        <Routes>
          <Route path="/dashboard/logs" element={<Logs />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestsByName.api.length).toBeGreaterThan(0);
    });

    const [processSelect] = await screen.findAllByRole("combobox");
    fireEvent.change(processSelect, { target: { value: "worker" } });

    await waitFor(() => {
      expect(requestsByName.worker.length).toBeGreaterThan(0);
    });

    await act(async () => {
      requestsByName.worker[0].resolve({
        success: true,
        data: {
          stdout: ["worker newest line"],
          stderr: []
        },
        error: null
      });
      await Promise.resolve();
    });

    expect(await screen.findByText("worker newest line")).toBeInTheDocument();

    await act(async () => {
      requestsByName.api.forEach((request) => {
        request.resolve({
          success: true,
          data: {
            stdout: ["api stale line"],
            stderr: []
          },
          error: null
        });
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText("api stale line")).not.toBeInTheDocument();
    });
  });

  it("reports a failed stream read instead of showing Waiting", async () => {
    logsMock.mockRejectedValue({ response: { status: 500 } });

    render(
      <MemoryRouter initialEntries={["/dashboard/logs"]}>
        <Routes>
          <Route path="/dashboard/logs" element={<Logs />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByText("The server hit a problem. Retry, and check the server log if it repeats.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Waiting.")).not.toBeInTheDocument();
    // The failure stays on the stream, so a toast would only repeat it.
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("treats an unreadable log file as a failure, not an empty stream", async () => {
    logsMock.mockResolvedValue({ success: false, data: null, error: "Log file is not readable" });

    render(
      <MemoryRouter initialEntries={["/dashboard/logs"]}>
        <Routes>
          <Route path="/dashboard/logs" element={<Logs />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Log file is not readable")).toBeInTheDocument();
    expect(screen.queryByText("Waiting.")).not.toBeInTheDocument();
  });

  it("retries the stream and clears the error once lines arrive", async () => {
    let attempts = 0;
    logsMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject({ response: { status: 503 } });
      }
      return Promise.resolve({ success: true, data: { stdout: ["recovered line"], stderr: [] }, error: null });
    });

    render(
      <MemoryRouter initialEntries={["/dashboard/logs"]}>
        <Routes>
          <Route path="/dashboard/logs" element={<Logs />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    expect(await screen.findByText("recovered line")).toBeInTheDocument();
    expect(attempts).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

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
});

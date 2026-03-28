import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const catalogMock = vi.fn();
const monitoringSummaryMock = vi.fn();
const metricsMock = vi.fn();
const socketState = {
  processes: [
    {
      id: 1,
      name: "api",
      status: "online",
      cpu: 12,
      memory: 104857600,
      uptime: 120000,
      restarts: 0,
      port: 3000,
      mode: "fork"
    },
    {
      id: 2,
      name: "worker",
      status: "online",
      cpu: 4,
      memory: 52428800,
      uptime: 100000,
      restarts: 1,
      port: null,
      mode: "fork"
    }
  ],
  alerts: [],
  logsByProcess: {},
  notifications: [],
  connected: true,
  reconnecting: false
};

vi.mock("../hooks/useSocket", () => ({
  useSocket: () => socketState
}));

vi.mock("../api", () => ({
  processes: {
    catalog: (...args) => catalogMock(...args),
    monitoringSummary: (...args) => monitoringSummaryMock(...args),
    metrics: (...args) => metricsMock(...args)
  }
}));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn((promise) => promise)
  },
  getErrorMessage: (error, fallback) => error?.message || fallback
}));

describe("Dashboard", () => {
  beforeEach(() => {
    catalogMock.mockReset();
    monitoringSummaryMock.mockReset();
    metricsMock.mockReset();
    catalogMock.mockResolvedValue({
      success: true,
      data: {
        meta: {
          worker: {
            dependencies: ["api"],
            alertThresholds: { cpu: null, memoryMB: null }
          }
        },
        processes: []
      },
      error: null
    });
    monitoringSummaryMock.mockResolvedValue({ success: true, data: [], error: null });
    metricsMock.mockResolvedValue({ success: true, data: [], error: null });
  });

  it("renders dependency graph relationships from process metadata", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText("Dependency Graph")).toBeInTheDocument();
    await waitFor(() => {
      const relation = screen.getAllByText(/depends on/i)[0];
      expect(relation).toBeInTheDocument();
      const line = relation.closest("div");
      expect(line?.textContent || "").toContain("worker");
      expect(line?.textContent || "").toContain("api");
    });
  });
});

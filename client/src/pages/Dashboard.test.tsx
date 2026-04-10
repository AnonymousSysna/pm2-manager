import { render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
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
    socketState.alerts = [];
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

    expect(screen.getByText("Operations Overview")).toBeInTheDocument();
    expect(screen.getByText("Process Control")).toBeInTheDocument();
    expect(screen.getByText("Dependencies")).toBeInTheDocument();
    await waitFor(() => {
      const relation = screen.getAllByText(/depends on/i)[0];
      expect(relation).toBeInTheDocument();
      const line = relation.closest("div");
      expect(line?.textContent || "").toContain("worker");
      expect(line?.textContent || "").toContain("api");
    });
  });

  it("counts attention and healthy KPIs by unique process, not by incident rows", async () => {
    socketState.alerts = [
      { processName: "api", metric: "cpu", value: 95, threshold: 80, severity: "warning", ts: "2026-04-10T10:00:00.000Z" },
      { processName: "api", metric: "memory", value: 800, threshold: 512, severity: "danger", ts: "2026-04-10T10:01:00.000Z" }
    ];
    monitoringSummaryMock.mockResolvedValue({
      success: true,
      data: [
        { name: "api", anomaly: { isAnomaly: false, score: 0 } },
        { name: "worker", anomaly: { isAnomaly: false, score: 0 } }
      ],
      error: null
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await screen.findByText("Operations Overview");

    expect(screen.getByText("1 process needs attention")).toBeInTheDocument();
    const healthyNote = screen.getByText("Online processes without active alert noise");
    expect(within(healthyNote.parentElement as HTMLElement).getByText("1")).toBeInTheDocument();
  });
});

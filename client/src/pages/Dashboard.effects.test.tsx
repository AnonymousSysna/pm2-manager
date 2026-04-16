import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const catalogMock = vi.fn();
const monitoringSummaryMock = vi.fn();
const metricsMock = vi.fn();
const systemResourcesMock = vi.fn();
const processListMock = vi.fn();
const listChannelsMock = vi.fn();
const caddyStatusMock = vi.fn();

const socketState = {
  processes: [
    { id: 1, name: "api", status: "online", cpu: 12, memory: 104857600, uptime: 120000, restarts: 0, port: 3000, mode: "fork" },
    { id: 2, name: "worker", status: "online", cpu: 4, memory: 52428800, uptime: 100000, restarts: 1, port: null, mode: "fork" }
  ],
  alerts: [],
  logsByProcess: {},
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
    catalog: (...args) => catalogMock(...args),
    monitoringSummary: (...args) => monitoringSummaryMock(...args),
    metrics: (...args) => metricsMock(...args),
    systemResources: (...args) => systemResourcesMock(...args),
    list: (...args) => processListMock(...args)
  },
  alerts: {
    listChannels: (...args) => listChannelsMock(...args)
  },
  caddy: {
    status: (...args) => caddyStatusMock(...args)
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

vi.mock("../components/ProcessDetailModal", () => ({
  __esModule: true,
  default: () => null
}));

vi.mock("../components/dashboard/OperationsOverviewPanel", () => ({
  __esModule: true,
  default: () => <div>Operations Overview</div>
}));

vi.mock("../components/dashboard/SetupChecklistPanel", () => ({
  __esModule: true,
  default: () => <div>Setup Checklist</div>
}));

vi.mock("../components/dashboard/SystemResourcesPanel", () => ({
  __esModule: true,
  default: () => <div>System Resources</div>
}));

vi.mock("../components/dashboard/DependencyGraphPanel", () => ({
  __esModule: true,
  default: () => <div>Dependencies</div>
}));

vi.mock("../components/dashboard/ThresholdAlertsPanel", () => ({
  __esModule: true,
  default: () => <div>Threshold Alerts</div>
}));

vi.mock("../components/dashboard/ProcessListPanel", () => ({
  __esModule: true,
  default: () => <div>Process Control</div>
}));

vi.mock("../components/dashboard/MetricsHistoryPanel", () => ({
  __esModule: true,
  default: ({ chartProcess, onChartProcessChange, processes, historyPoints }) => (
    <section>
      <label htmlFor="chart-process">Chart process</label>
      <select id="chart-process" value={chartProcess} onChange={(event) => onChartProcessChange(event.target.value)}>
        {processes.map((proc) => (
          <option key={proc.name} value={proc.name}>
            {proc.name}
          </option>
        ))}
      </select>
      <output data-testid="history-points">{JSON.stringify(historyPoints)}</output>
    </section>
  )
}));

vi.mock("../components/dashboard/DashboardModals", () => ({
  DeployProcessModal: () => null,
  DotEnvDiffModal: () => null,
  DotEnvEditorModal: () => null,
  ProcessActionDialog: () => null,
  ProcessMetaModal: () => null
}));

describe("Dashboard async effects", () => {
  beforeEach(() => {
    catalogMock.mockReset();
    monitoringSummaryMock.mockReset();
    metricsMock.mockReset();
    systemResourcesMock.mockReset();
    processListMock.mockReset();
    listChannelsMock.mockReset();
    caddyStatusMock.mockReset();

    catalogMock.mockResolvedValue({ success: true, data: { meta: {}, processes: [] }, error: null });
    monitoringSummaryMock.mockResolvedValue({ success: true, data: [], error: null });
    systemResourcesMock.mockResolvedValue({ success: true, data: null, error: null });
    processListMock.mockResolvedValue({ success: true, data: socketState.processes, error: null });
    listChannelsMock.mockResolvedValue({ success: true, data: [], error: null });
    caddyStatusMock.mockResolvedValue({ success: true, data: { managedSites: [] }, error: null });
  });

  it("ignores stale metric responses after rapid chart selection changes", async () => {
    const requestsByName = {
      api: [],
      worker: []
    };

    metricsMock.mockImplementation((name) => {
      const request = deferred();
      requestsByName[name].push(request);
      return request.promise;
    });

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(requestsByName.api.length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText("Chart process"), { target: { value: "worker" } });

    await waitFor(() => {
      expect(requestsByName.worker.length).toBeGreaterThan(0);
    });

    await act(async () => {
      requestsByName.worker[0].resolve({
        success: true,
        data: [{ cpu: 55, memory: 1024 }],
        error: null
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-points")).toHaveTextContent("55");
    });

    await act(async () => {
      requestsByName.api.forEach((request) => {
        request.resolve({
          success: true,
          data: [{ cpu: 99, memory: 2048 }],
          error: null
        });
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-points")).toHaveTextContent("55");
      expect(screen.getByTestId("history-points")).not.toHaveTextContent("99");
    });
  });
});

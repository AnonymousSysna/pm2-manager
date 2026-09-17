import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

// Budgets for the overview page in the fixture below (three processes, six
// alerts, one of them errored). They are not aspirational numbers: they are the
// state the page was reduced to, and they exist so that adding a seventh panel
// or another five controls to the busiest screen is a decision rather than an
// accident. Raise a budget in the same commit that raises the page and say why.
const BUDGET = {
  panels: 6,
  sections: 7,
  buttons: 30,
  inputs: 6,
  textChars: 982
};

const catalogMock = vi.fn();
const monitoringSummaryMock = vi.fn();
const metricsMock = vi.fn();

const socketState = {
  processes: [
    { id: 1, name: "api", status: "online", cpu: 91, memory: 104857600, uptime: 120000, restarts: 0, port: 3000, mode: "fork" },
    { id: 2, name: "worker", status: "errored", cpu: 4, memory: 52428800, uptime: 100000, restarts: 7, port: null, mode: "fork" },
    { id: 3, name: "billing", status: "online", cpu: 20, memory: 73400320, uptime: 90000, restarts: 2, port: 4100, mode: "fork" }
  ],
  alerts: [
    { processName: "api", metric: "cpu", value: 91, threshold: 80, severity: "warning", ts: "2026-04-10T10:00:00.000Z", message: "cpu above threshold" },
    { processName: "api", metric: "memory", value: 800, threshold: 512, severity: "danger", ts: "2026-04-10T10:01:00.000Z", message: "memory above threshold" },
    { processName: "billing", metric: "cpu", value: 88, threshold: 80, severity: "warning", ts: "2026-04-10T10:02:00.000Z", message: "cpu above threshold" },
    { processName: "billing", metric: "health", value: 3, threshold: 2, severity: "danger", ts: "2026-04-10T10:03:00.000Z", message: "health probe failing" },
    { processName: "worker", metric: "cpu", value: 95, threshold: 80, severity: "warning", ts: "2026-04-10T10:04:00.000Z", message: "cpu above threshold" },
    { processName: "worker", metric: "restarts", value: 7, threshold: 5, severity: "warning", ts: "2026-04-10T10:05:00.000Z", message: "restart loop" }
  ],
  logsByProcess: {},
  notifications: [],
  createStepEvents: [],
  monitorError: "",
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
    metrics: (...args) => metricsMock(...args),
    systemResources: vi.fn(async () => ({ success: true, data: null, error: null })),
    list: vi.fn(async () => ({ success: true, data: [], error: null }))
  },
  alerts: {
    listChannels: vi.fn(async () => ({ success: true, data: [], error: null }))
  },
  caddy: {
    status: vi.fn(async () => ({ success: true, data: null, error: null }))
  }
}));

vi.mock("../components/ProcessDetailModal", () => ({ __esModule: true, default: () => null }));

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

async function renderOverview() {
  const { container } = render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getAllByText("Triage").length).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return container;
}

describe("Overview cognitive load", () => {
  beforeEach(() => {
    catalogMock.mockReset();
    monitoringSummaryMock.mockReset();
    metricsMock.mockReset();
    catalogMock.mockResolvedValue({
      success: true,
      data: { meta: { worker: { dependencies: ["api"] } }, processes: [] },
      error: null
    });
    monitoringSummaryMock.mockResolvedValue({ success: true, data: [], error: null });
    metricsMock.mockResolvedValue({ success: true, data: [], error: null });
  });

  it("stays within the panel, control, and text budget", async () => {
    const container = await renderOverview();
    const counted = {
      panels: container.querySelectorAll("section.page-panel").length,
      sections: container.querySelectorAll("section").length,
      buttons: container.querySelectorAll("button").length,
      inputs: container.querySelectorAll("input, select, textarea").length,
      textChars: (container.textContent || "").length
    };

    for (const [metric, budget] of Object.entries(BUDGET)) {
      expect(
        counted[metric],
        `Overview ${metric} is ${counted[metric]}, over the budget of ${budget}. ` +
          "Either shrink the page or raise the budget deliberately."
      ).toBeLessThanOrEqual(budget);
    }
  });

  it("shows an alert once, with its message, instead of in a second feed", async () => {
    const container = await renderOverview();

    // The queue reports the alert's own text, not just the numbers.
    expect(screen.getAllByText(/health probe failing/).length).toBe(1);
    // And no second surface repeats the same alert list.
    expect(container.querySelectorAll("section.page-panel").length).toBeLessThanOrEqual(6);
  });
});

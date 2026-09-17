import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { accessibleName, unnamedControls, visibleControls } from "../test/accessibleName";
import Dashboard from "./Dashboard";

// The overview is the busiest screen in the app, and its row controls are
// icon-only. This fixture renders it with a process list, a triage queue, and
// the support panels, then requires every interactive control to carry a name
// that a screen reader can announce. See ../test/accessibleName for what counts.
const catalogMock = vi.fn();
const monitoringSummaryMock = vi.fn();
const metricsMock = vi.fn();

const socketState = {
  processes: [
    { id: 1, name: "api", status: "online", cpu: 91, memory: 104857600, uptime: 120000, restarts: 0, port: 3000, mode: "fork" },
    { id: 2, name: "worker", status: "errored", cpu: 4, memory: 52428800, uptime: 100000, restarts: 7, port: null, mode: "fork" }
  ],
  alerts: [
    { processName: "api", metric: "cpu", value: 91, threshold: 80, severity: "warning", ts: "2026-04-10T10:00:00.000Z", message: "cpu above threshold" }
  ],
  logsByProcess: {},
  notifications: [],
  createStepEvents: [],
  monitorError: "",
  connected: true,
  reconnecting: false
};

vi.mock("../hooks/useSocket", () => ({ useSocket: () => socketState }));

vi.mock("../api", () => ({
  processes: {
    catalog: (...args) => catalogMock(...args),
    monitoringSummary: (...args) => monitoringSummaryMock(...args),
    metrics: (...args) => metricsMock(...args),
    systemResources: vi.fn(async () => ({
      success: true,
      data: { cpu: { cores: 8 }, memory: { usedBytes: 1, totalBytes: 2, usedPercent: 50 }, disk: { mounts: [] } },
      error: null
    })),
    list: vi.fn(async () => ({ success: true, data: [], error: null }))
  },
  alerts: { listChannels: vi.fn(async () => ({ success: true, data: [], error: null })) },
  caddy: { status: vi.fn(async () => ({ success: true, data: null, error: null })) }
}));

vi.mock("../components/ProcessDetailModal", () => ({ __esModule: true, default: () => null }));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), promise: vi.fn((promise) => promise) },
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

describe("Overview accessible names", () => {
  beforeEach(() => {
    catalogMock.mockReset();
    monitoringSummaryMock.mockReset();
    metricsMock.mockReset();
    catalogMock.mockResolvedValue({ success: true, data: { meta: {}, processes: [] }, error: null });
    monitoringSummaryMock.mockResolvedValue({ success: true, data: [], error: null });
    metricsMock.mockResolvedValue({ success: true, data: [], error: null });
  });

  it("names every control in the page body", async () => {
    const container = await renderOverview();

    expect(visibleControls(container).length).toBeGreaterThan(20);
    expect(unnamedControls(container), "controls with no accessible name").toEqual([]);
  });

  it("names the search box, the selection boxes, and the row menus", async () => {
    const container = await renderOverview();

    expect(accessibleName(container.querySelector("input[placeholder='Search processes']") as Element)).toBe(
      "Search processes"
    );

    expect(accessibleName(container.querySelector(".process-list-header input") as Element)).toBe(
      "Select all processes"
    );

    expect(
      [...container.querySelectorAll(".process-select-cell input")].map((box) => accessibleName(box))
    ).toEqual(["Select api", "Select worker"]);

    expect([...container.querySelectorAll("button.process-row-more")].map((button) => accessibleName(button))).toEqual([
      "More actions for api",
      "More actions for worker"
    ]);

    expect(accessibleName(container.querySelector("select") as Element)).toBe("Process to chart");
  });

  it("names the controls the row menu opens", async () => {
    const container = await renderOverview();

    fireEvent.click(container.querySelector("button.process-row-more") as Element);
    await waitFor(() => expect(document.querySelector(".process-row-menu-portal")).not.toBeNull());

    const menuItems = [...document.querySelectorAll(".process-row-menu-portal button")];
    expect(menuItems.length).toBeGreaterThan(5);
    expect(unnamedControls(document.body), "controls with no accessible name").toEqual([]);
  });
});

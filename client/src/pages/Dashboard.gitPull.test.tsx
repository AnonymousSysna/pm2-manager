import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn((promise: Promise<unknown>) => promise)
}));

const getMock = vi.fn();
const gitStatusMock = vi.fn();
const gitPullMock = vi.fn();
const catalogMock = vi.fn();
const monitoringSummaryMock = vi.fn();
const metricsMock = vi.fn();
const systemResourcesMock = vi.fn();
const processListMock = vi.fn();
const listChannelsMock = vi.fn();
const caddyStatusMock = vi.fn();

const socketProcesses = [
  { id: 1, name: "api", status: "online", cpu: 12, memory: 104857600, uptime: 120000, restarts: 0, port: 3000, mode: "fork" }
];

vi.mock("../hooks/useSocket", () => ({
  useSocket: () => ({
    processes: socketProcesses,
    alerts: [],
    logsByProcess: {},
    notifications: [],
    createStepEvents: [],
    monitorError: "",
    connected: true,
    reconnecting: false
  })
}));

vi.mock("../api", () => ({
  processes: {
    catalog: (...args: unknown[]) => catalogMock(...args),
    monitoringSummary: (...args: unknown[]) => monitoringSummaryMock(...args),
    metrics: (...args: unknown[]) => metricsMock(...args),
    systemResources: (...args: unknown[]) => systemResourcesMock(...args),
    list: (...args: unknown[]) => processListMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    gitStatus: (...args: unknown[]) => gitStatusMock(...args),
    gitPull: (...args: unknown[]) => gitPullMock(...args)
  },
  alerts: {
    listChannels: (...args: unknown[]) => listChannelsMock(...args)
  },
  caddy: {
    status: (...args: unknown[]) => caddyStatusMock(...args)
  }
}));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: toastMock,
  getErrorMessage: (error: Error | undefined, fallback: string) => error?.message || fallback
}));

vi.mock("../components/dashboard/ProcessListPanel", () => ({
  __esModule: true,
  default: ({ items, controls }) => (
    <button type="button" onClick={() => controls.openDetails(items[0].proc)}>
      inspect api
    </button>
  )
}));

vi.mock("../components/ProcessDetailModal", () => ({
  __esModule: true,
  default: ({ process, onAction }) => (process ? (
    <button type="button" onClick={() => onAction("gitPull", process.name)}>
      panel git pull
    </button>
  ) : null)
}));

vi.mock("../components/dashboard/OperationsOverviewPanel", () => ({ __esModule: true, default: () => null }));
vi.mock("../components/dashboard/SetupChecklistPanel", () => ({ __esModule: true, default: () => null }));
vi.mock("../components/dashboard/SystemResourcesPanel", () => ({ __esModule: true, default: () => null }));
vi.mock("../components/dashboard/DependencyGraphPanel", () => ({ __esModule: true, default: () => null }));
vi.mock("../components/dashboard/MetricsHistoryPanel", () => ({ __esModule: true, default: () => null }));
vi.mock("../components/dashboard/DashboardModals", () => ({
  DeployProcessModal: () => null,
  DotEnvDiffModal: () => null,
  DotEnvEditorModal: () => null,
  ProcessActionDialog: () => null,
  ProcessMetaModal: () => null
}));

async function openPanelGitPull() {
  const user = userEvent.setup();

  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

  await user.click(await screen.findByRole("button", { name: "inspect api" }));
  await user.click(await screen.findByRole("button", { name: "panel git pull" }));

  return user;
}

describe("Dashboard git pull from the process panel", () => {
  beforeEach(() => {
    Object.values(toastMock).forEach((value) => {
      if (typeof value?.mockReset === "function") {
        value.mockReset();
      }
    });
    toastMock.promise.mockImplementation((promise: Promise<unknown>) => promise);

    getMock.mockReset();
    gitStatusMock.mockReset();
    gitPullMock.mockReset();
    catalogMock.mockReset();
    monitoringSummaryMock.mockReset();
    metricsMock.mockReset();
    systemResourcesMock.mockReset();
    processListMock.mockReset();
    listChannelsMock.mockReset();
    caddyStatusMock.mockReset();

    catalogMock.mockResolvedValue({ success: true, data: { meta: {}, processes: [] }, error: null });
    monitoringSummaryMock.mockResolvedValue({ success: true, data: [], error: null });
    metricsMock.mockResolvedValue({ success: true, data: [], error: null });
    systemResourcesMock.mockResolvedValue({ success: true, data: null, error: null });
    processListMock.mockResolvedValue({ success: true, data: socketProcesses, error: null });
    listChannelsMock.mockResolvedValue({ success: true, data: [], error: null });
    caddyStatusMock.mockResolvedValue({ success: true, data: { managedSites: [] }, error: null });
    getMock.mockResolvedValue({ success: true, data: { details: { pm2_env: { env: {} } } }, error: null });
    gitStatusMock.mockResolvedValue({ success: true, data: { dirty: false }, error: null });
    gitPullMock.mockResolvedValue({ success: true, data: { output: "Already up to date." }, error: null });
  });

  it("notifies once for a clean pull instead of twice", async () => {
    await openPanelGitPull();

    await waitFor(() => {
      expect(gitPullMock).toHaveBeenCalledWith("api", {});
    });

    expect(toastMock.info).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();

    const promiseCalls = toastMock.promise.mock.calls;
    expect(promiseCalls).toHaveLength(1);
    expect(promiseCalls[0][1]).toMatchObject({
      loading: "Git pull running for api...",
      success: "Git pull finished for api"
    });
  });

  it("asks for confirmation with design-system buttons when the tree is dirty", async () => {
    gitStatusMock.mockResolvedValue({
      success: true,
      data: {
        dirty: true,
        cwd: "/app",
        totalChanged: 1,
        changedFiles: [{ path: "src/index.js", status: "M" }]
      },
      error: null
    });

    await openPanelGitPull();

    await waitFor(() => {
      expect(toastMock.warning).toHaveBeenCalled();
    });

    const [title, options] = toastMock.warning.mock.calls[0];
    expect(title).toBe("Local changes in api");
    expect(options.action).toBeUndefined();
    expect(toastMock.promise).not.toHaveBeenCalled();
    expect(gitPullMock).not.toHaveBeenCalled();

    render(options.description);
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const accept = screen.getByRole("button", { name: "Accept pull" });
    for (const button of [cancel, accept]) {
      expect(button).toHaveClass("rounded-xl");
      expect(button).not.toHaveClass("gooey-actionButton");
      expect(button.className).not.toMatch(/git-pull-toast-cancel/);
    }

    await userEvent.click(accept);

    await waitFor(() => {
      expect(gitPullMock).toHaveBeenCalledWith("api", expect.objectContaining({ dirtyMode: "stash" }));
    });
  });
});

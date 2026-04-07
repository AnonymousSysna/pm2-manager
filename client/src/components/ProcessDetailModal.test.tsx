import { render, screen, waitFor } from "@testing-library/react";
import ProcessDetailModal from "./ProcessDetailModal";

const metricsMock = vi.fn();

vi.mock("../api", () => ({
  processes: {
    metrics: (...args: unknown[]) => metricsMock(...args)
  }
}));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn((promise: Promise<unknown>) => promise)
  }
}));

describe("ProcessDetailModal", () => {
  beforeEach(() => {
    metricsMock.mockReset();
    metricsMock.mockResolvedValue({ success: true, data: [], error: null });
  });

  it("does not render a duplicate ppid field from pid data", async () => {
    render(
      <ProcessDetailModal
        process={{
          name: "api",
          pid: 4321,
          status: "online",
          restarts: 0,
          uptime: 1200,
          port: 3000,
          mode: "fork",
          details: {
            pid: 4321,
            pm2_env: {
              env: {},
              pm_exec_path: "/app/index.js",
              pm_cwd: "/app"
            }
          }
        }}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onViewDeployHistory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(metricsMock).toHaveBeenCalledWith("api", 120);
    });

    expect(screen.getByText(/^pid$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^ppid$/i)).not.toBeInTheDocument();
  });
});

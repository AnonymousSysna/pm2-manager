import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
          uptime: 125000,
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
    expect(screen.getByText("2m 5s")).toBeInTheDocument();
  });

  it("keeps the panel compact with fact rows and small action buttons", async () => {
    const user = userEvent.setup();

    render(
      <ProcessDetailModal
        process={{
          name: "api",
          pid: 4321,
          status: "online",
          restarts: 0,
          uptime: 125000,
          port: 3000,
          mode: "fork",
          details: {
            pm2_env: {
              env: {},
              pm_cwd: "/srv/apps/very-long-working-directory-name/api",
              pm_exec_path: "/srv/apps/very-long-working-directory-name/api/index.js"
            }
          }
        }}
        onClose={vi.fn()}
        onAction={vi.fn()}
        onViewDeployHistory={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(metricsMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Working dir").closest("dl")).not.toBeNull();
    expect(screen.getByText("/srv/apps/very-long-working-directory-name/api")).toHaveAttribute(
      "title",
      "/srv/apps/very-long-working-directory-name/api"
    );

    await user.click(screen.getByRole("tab", { name: "Actions" }));

    expect(screen.getByRole("button", { name: "Stop" })).toHaveClass("min-h-9");
    expect(screen.getByRole("button", { name: /Delete process/ })).toHaveClass("min-h-9");
  });
});

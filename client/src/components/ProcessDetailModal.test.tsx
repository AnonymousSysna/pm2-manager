import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProcessDetailModal from "./ProcessDetailModal";

const metricsMock = vi.fn();
const healthMock = vi.fn();

vi.mock("../api", () => ({
  processes: {
    metrics: (...args: unknown[]) => metricsMock(...args),
    health: (...args: unknown[]) => healthMock(...args)
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
    healthMock.mockReset();
    metricsMock.mockResolvedValue({ success: true, data: [], error: null });
    healthMock.mockResolvedValue({ success: true, data: { points: [], summary: null }, error: null });
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

  it("says the metrics read failed instead of showing an empty panel", async () => {
    metricsMock.mockRejectedValue({ response: { status: 500 } });

    render(<ProcessDetailModal process={{ name: "api", status: "online" }} onClose={vi.fn()} onAction={vi.fn()} />);

    expect(
      await screen.findByText("The server hit a problem. Retry, and check the server log if it repeats.")
    ).toBeInTheDocument();
    expect(screen.queryByText("No metrics.")).not.toBeInTheDocument();
  });

  it("keeps the empty copy when the process simply has no samples", async () => {
    render(<ProcessDetailModal process={{ name: "api", status: "online" }} onClose={vi.fn()} onAction={vi.fn()} />);

    expect(await screen.findByText("No metrics.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("re-reads telemetry when the operator retries", async () => {
    let attempts = 0;
    metricsMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject({ response: { status: 503 } });
      }
      return Promise.resolve({ success: true, data: [{ ts: 1, cpu: 12, memory: 1024 }], error: null });
    });

    render(<ProcessDetailModal process={{ name: "api", status: "online" }} onClose={vi.fn()} onAction={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
    expect(attempts).toBe(2);
    expect(screen.getByText(/CPU 12%/)).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Settings from "./Settings";

const infoMock = vi.fn();
const listChannelsMock = vi.fn();
const readinessMock = vi.fn();

vi.mock("../api", () => ({
  auth: { changePassword: vi.fn() },
  pm2Admin: {
    info: (...args) => infoMock(...args),
    save: vi.fn(),
    resurrect: vi.fn(),
    startup: vi.fn(),
    kill: vi.fn()
  },
  alerts: {
    listChannels: (...args) => listChannelsMock(...args),
    saveChannel: vi.fn(),
    deleteChannel: vi.fn(),
    testChannel: vi.fn()
  },
  processes: {
    exportConfig: vi.fn(),
    importConfig: vi.fn()
  },
  system: {
    readiness: (...args) => readinessMock(...args)
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

describe("Settings alert channel loading", () => {
  beforeEach(() => {
    infoMock.mockReset();
    listChannelsMock.mockReset();
    readinessMock.mockReset();

    infoMock.mockResolvedValue({ success: true, data: { version: "5.3.0" }, error: null });
    readinessMock.mockResolvedValue({ success: true, data: { ok: true, issues: [], warnings: [] }, error: null });
  });

  it("says the read failed instead of claiming no channels are configured", async () => {
    listChannelsMock.mockRejectedValue({ response: { status: 500 } });

    render(<Settings />);

    expect(
      await screen.findByText("The server hit a problem. Retry, and check the server log if it repeats.")
    ).toBeInTheDocument();
    expect(screen.queryByText("No channels configured.")).not.toBeInTheDocument();
  });

  it("keeps the empty state when there really are no channels", async () => {
    listChannelsMock.mockResolvedValue({ success: true, data: [], error: null });

    render(<Settings />);

    expect(await screen.findByText("No channels configured.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("recovers on retry", async () => {
    let attempts = 0;
    listChannelsMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject({ response: { status: 503 } });
      }
      return Promise.resolve({
        success: true,
        data: [{ id: "channel-1", name: "ops-slack", type: "slack", severity: "warning", enabled: true }],
        error: null
      });
    });

    render(<Settings />);

    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);

    expect(await screen.findByText("ops-slack")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("No channels configured.")).not.toBeInTheDocument();
  });
});

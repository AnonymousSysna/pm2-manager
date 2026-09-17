import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Caddy from "./Caddy";

const statusMock = vi.fn();
const addProxyMock = vi.fn();
const deleteProxyMock = vi.fn();
const restartMock = vi.fn();

vi.mock("../api", () => ({
  caddy: {
    status: (...args: unknown[]) => statusMock(...args),
    addProxy: (...args: unknown[]) => addProxyMock(...args),
    deleteProxy: (...args: unknown[]) => deleteProxyMock(...args),
    restart: (...args: unknown[]) => restartMock(...args)
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
  },
  getErrorMessage: (error: Error | undefined, fallback: string) => error?.message || fallback
}));

const managedSite = {
  domain: "app.example.com",
  siteAddress: "app.example.com",
  upstream: "localhost:3000",
  publicUrl: "https://app.example.com",
  https: { state: "active" }
};

function mockStatus(managedSites: unknown[] = []) {
  statusMock.mockResolvedValue({
    success: true,
    data: { installed: true, caddyfilePath: "/etc/caddy/Caddyfile", managedSites },
    error: null
  });
}

describe("Caddy reverse proxy form", () => {
  beforeEach(() => {
    statusMock.mockReset();
    addProxyMock.mockReset();
    deleteProxyMock.mockReset();
    restartMock.mockReset();
    mockStatus();
    addProxyMock.mockResolvedValue({ success: true, data: {}, error: null });
    localStorage.clear();
  });

  it("keeps the page compact until the modal is opened", async () => {
    const user = userEvent.setup();

    render(<Caddy />);

    await waitFor(() => {
      expect(statusMock).toHaveBeenCalled();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Domain *")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add reverse proxy" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Domain *")).toHaveValue("");
    expect(within(dialog).getByLabelText("Upstream *")).toHaveValue("localhost:3000");
  });

  it("adds a reverse proxy through the modal and closes it on success", async () => {
    const user = userEvent.setup();

    render(<Caddy />);

    await waitFor(() => {
      expect(statusMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Add reverse proxy" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Add proxy" });

    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Domain *"), "app.example.com");
    await user.clear(within(dialog).getByLabelText("Upstream *"));
    await user.type(within(dialog).getByLabelText("Upstream *"), "localhost:4000");
    await user.click(submit);

    await waitFor(() => {
      expect(addProxyMock).toHaveBeenCalledWith({
        domain: "app.example.com",
        siteAddress: "app.example.com",
        upstream: "localhost:4000"
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("prefills the modal when editing a managed domain", async () => {
    const user = userEvent.setup();
    mockStatus([managedSite]);

    render(<Caddy />);

    await waitFor(() => {
      expect(screen.getByText("reverse_proxy localhost:3000")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Update reverse proxy" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Domain *")).toHaveValue("app.example.com");
    expect(within(dialog).getByLabelText("Upstream *")).toHaveValue("localhost:3000");
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("closes the modal on cancel without saving", async () => {
    const user = userEvent.setup();

    render(<Caddy />);

    await waitFor(() => {
      expect(statusMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Add reverse proxy" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Domain *"), "app.example.com");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(addProxyMock).not.toHaveBeenCalled();
  });
});

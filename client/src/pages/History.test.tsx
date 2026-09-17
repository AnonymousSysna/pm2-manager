import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import History from "./History";

const deploymentHistoryPageMock = vi.fn();
const restartHistoryPageMock = vi.fn();
const auditHistoryPageMock = vi.fn();

vi.mock("../api", () => ({
  processes: {
    deploymentHistoryPage: (...args) => deploymentHistoryPageMock(...args),
    restartHistoryPage: (...args) => restartHistoryPageMock(...args),
    auditHistoryPage: (...args) => auditHistoryPageMock(...args)
  }
}));

const serverError = { response: { status: 500 } };

function emptyPage() {
  return { success: true, data: { items: [], pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } }, error: null };
}

function page(items) {
  return { success: true, data: { items, pagination: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 } }, error: null };
}

function renderHistory() {
  return render(
    <MemoryRouter>
      <History />
    </MemoryRouter>
  );
}

describe("History load failures", () => {
  beforeEach(() => {
    deploymentHistoryPageMock.mockReset();
    restartHistoryPageMock.mockReset();
    auditHistoryPageMock.mockReset();
  });

  it("reports a failed read instead of claiming there is no history", async () => {
    deploymentHistoryPageMock.mockRejectedValue(serverError);
    restartHistoryPageMock.mockResolvedValue(emptyPage());
    auditHistoryPageMock.mockResolvedValue(emptyPage());

    renderHistory();

    expect(await screen.findByText("The server hit a problem. Retry, and check the server log if it repeats.")).toBeInTheDocument();
    expect(screen.queryByText("No deployments.")).not.toBeInTheDocument();
    // The other two sections loaded fine, so they keep their empty copy.
    expect(screen.getByText("No restarts.")).toBeInTheDocument();
    expect(screen.getByText("No audit entries.")).toBeInTheDocument();
  });

  it("treats a rejected envelope as a failure too", async () => {
    deploymentHistoryPageMock.mockResolvedValue({ success: false, data: null, error: "History index is rebuilding" });
    restartHistoryPageMock.mockResolvedValue(emptyPage());
    auditHistoryPageMock.mockResolvedValue(emptyPage());

    renderHistory();

    expect(await screen.findByText("History index is rebuilding")).toBeInTheDocument();
    expect(screen.queryByText("No deployments.")).not.toBeInTheDocument();
  });

  it("keeps the empty copy when the read simply returned nothing", async () => {
    deploymentHistoryPageMock.mockResolvedValue(emptyPage());
    restartHistoryPageMock.mockResolvedValue(emptyPage());
    auditHistoryPageMock.mockResolvedValue(emptyPage());

    renderHistory();

    expect(await screen.findByText("No deployments.")).toBeInTheDocument();
    expect(screen.getByText("No restarts.")).toBeInTheDocument();
    expect(screen.getByText("No audit entries.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("retries the failed section and clears the error once it loads", async () => {
    // The mount effect and the filter effect both load on first render, so the
    // first two calls fail before the operator can press Retry.
    let attempts = 0;
    deploymentHistoryPageMock.mockImplementation(() => {
      attempts += 1;
      if (attempts <= 2) {
        return Promise.reject(serverError);
      }
      return Promise.resolve(
        page([{ processName: "api", action: "deploy", actor: "root", success: true, ts: Date.parse("2026-05-05T00:00:00Z") }])
      );
    });
    restartHistoryPageMock.mockResolvedValue(emptyPage());
    auditHistoryPageMock.mockResolvedValue(emptyPage());

    renderHistory();

    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(attempts).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText(/api deployment by root succeeded/)).toBeInTheDocument();
    expect(attempts).toBe(3);
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByText("No deployments.")).not.toBeInTheDocument();
  });
});

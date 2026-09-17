import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OperationsOverviewPanel from "./OperationsOverviewPanel";

const processes = [
  { name: "api", status: "online", restarts: 0 },
  { name: "worker", status: "errored", restarts: 7 }
];

const alerts = [
  { processName: "billing", metric: "health", value: 3, threshold: 2, severity: "danger", ts: "2026-04-10T10:03:00.000Z", message: "health probe failing" },
  { processName: "", metric: "cpu", value: 99, threshold: 80, severity: "warning", ts: "2026-04-10T10:04:00.000Z", message: "cpu above threshold" }
];

function renderPanel(overrides = {}) {
  const props = {
    stats: { online: 2, total: 3 },
    alerts,
    processes,
    monitoringSummary: {},
    onOpenLogs: vi.fn(),
    onOpenHistory: vi.fn(),
    ...overrides
  };
  const view = render(<OperationsOverviewPanel {...props} />);
  return { ...view, props };
}

function rowFor(text) {
  // The detail line lives in a wrapper inside the row's left column; the row is
  // the card that lays out side by side on wide screens.
  const detail = screen.getByText(text);
  let node = detail;
  while (node && !node.className.includes("lg:flex-row")) {
    node = node.parentElement;
  }
  return node;
}

describe("OperationsOverviewPanel", () => {
  it("scopes the row history link to the process the row is about", async () => {
    const user = userEvent.setup();
    const { props } = renderPanel();

    const row = rowFor(/health probe failing/);
    await user.click(within(row).getByRole("button", { name: "History" }));

    expect(props.onOpenHistory).toHaveBeenCalledWith("billing");
  });

  it("shows an alert's own message and offers no actions for an unknown process", () => {
    renderPanel();

    const row = rowFor(/cpu above threshold/);
    expect(within(row).queryByRole("button", { name: "Logs" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "History" })).toBeNull();
  });

  it("leaves the global entries to the page: two row controls and read-only cards", () => {
    const { container } = renderPanel();

    // Two rows carry a process, so four controls; the status cards no longer
    // carry any, and the panel no longer repeats the page's history entry.
    expect(within(container).getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Full timeline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open logs" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
    // The panel header carries its status badge and nothing else.
    expect(container.querySelector(".panel-actions button")).toBeNull();
  });
});

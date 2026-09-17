import { render, screen } from "@testing-library/react";
import { semanticToneClasses } from "./ui/semanticTones";
import { ConnectionBadge, ConnectionBanner } from "./ConnectionStatus";

const connection = vi.hoisted(() => ({
  value: {
    status: "live",
    badgeLabel: "Live",
    message: "",
    staleAgeMs: null as number | null,
    showingStaleData: false
  }
}));

vi.mock("../hooks/useConnectionState", () => ({
  useConnectionState: () => connection.value
}));

function setState(next: Partial<typeof connection.value>) {
  connection.value = { ...connection.value, ...next };
}

afterEach(() => {
  setState({ status: "live", badgeLabel: "Live", message: "", staleAgeMs: null, showingStaleData: false });
});

describe("ConnectionBanner", () => {
  it("stays out of the way while the connection is healthy", () => {
    const { container } = render(<ConnectionBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it("reports a paused live feed as a warning, not an error", () => {
    setState({ status: "reconnecting", badgeLabel: "Reconnecting", message: "Reconnecting. Live updates are paused." });

    render(<ConnectionBanner />);
    const banner = screen.getByText("Reconnecting. Live updates are paused.").closest("div[class*=rounded-xl]");

    expect(banner).toHaveClass(semanticToneClasses.warning.banner);
  });

  it("escalates a fully offline browser to an error", () => {
    setState({ status: "offline", badgeLabel: "Offline", message: "You are offline. Changes cannot be saved." });

    render(<ConnectionBanner />);
    const banner = screen.getByText("You are offline. Changes cannot be saved.").closest("div[class*=rounded-xl]");

    expect(banner).toHaveClass(semanticToneClasses.danger.banner);
  });
});

describe("ConnectionBadge", () => {
  it("maps each status onto one shared tone", () => {
    const { rerender } = render(<ConnectionBadge />);
    expect(screen.getByText("Live")).toHaveClass(semanticToneClasses.success.badge);

    setState({ status: "reconnecting", badgeLabel: "Reconnecting" });
    rerender(<ConnectionBadge />);
    expect(screen.getByText("Reconnecting")).toHaveClass(semanticToneClasses.warning.badge);

    setState({ status: "offline", badgeLabel: "Offline" });
    rerender(<ConnectionBadge />);
    expect(screen.getByText("Offline")).toHaveClass(semanticToneClasses.danger.badge);
  });
});

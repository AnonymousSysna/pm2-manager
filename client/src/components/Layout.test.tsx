import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Layout from "./Layout";

const socketState = vi.hoisted(() => ({
  value: {
    connected: true,
    reconnecting: false,
    processesUpdatedAt: null as number | null
  }
}));

vi.mock("../api", () => ({
  auth: { logout: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock("../hooks/useSocket", () => ({
  useSocket: () => socketState.value
}));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<div>overview</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Layout connection surfaces", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T00:00:00Z"));
    socketState.value = { connected: true, reconnecting: false, processesUpdatedAt: null };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows a live badge and no status strip while connected", () => {
    renderShell();

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces a paused feed once the socket drops, including data age", async () => {
    const syncAt = Date.parse("2026-05-05T00:00:00Z");
    socketState.value = {
      connected: false,
      reconnecting: true,
      processesUpdatedAt: syncAt - 4 * 60_000
    };

    renderShell();

    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Reconnecting. Live updates are paused; actions are still sent. Showing data from 4m ago."
    );

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
  });

  it("escalates a browser with no network to an offline error", () => {
    socketState.value = { connected: false, reconnecting: false, processesUpdatedAt: null };
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

    renderShell();

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/You are offline/);

    online.mockRestore();
  });
});

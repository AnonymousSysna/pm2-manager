import {
  DEFAULT_STALE_AFTER_MS,
  deriveConnectionState,
  formatStaleAge
} from "./connectionState";

describe("formatStaleAge", () => {
  it("uses one unit so the label stays short", () => {
    expect(formatStaleAge(0)).toBe("0s");
    expect(formatStaleAge(9_400)).toBe("9s");
    expect(formatStaleAge(59_999)).toBe("59s");
    expect(formatStaleAge(60_000)).toBe("1m");
    expect(formatStaleAge(4 * 60_000 + 20_000)).toBe("4m");
    expect(formatStaleAge(2 * 3_600_000)).toBe("2h");
    expect(formatStaleAge(-5)).toBe("0s");
  });
});

describe("deriveConnectionState", () => {
  const base = { online: true, connected: false, reconnecting: false, now: 1_000_000 };

  it("reports live and silent while the socket is connected", () => {
    const state = deriveConnectionState({
      ...base,
      connected: true,
      lastUpdateAt: base.now - 60_000
    });

    expect(state.status).toBe("live");
    expect(state.badgeLabel).toBe("Live");
    expect(state.message).toBe("");
    expect(state.showingStaleData).toBe(false);
    expect(state.staleAgeMs).toBe(60_000);
  });

  it("distinguishes browser offline from an unreachable server", () => {
    const offline = deriveConnectionState({ ...base, online: false, lastUpdateAt: base.now - 5_000 });
    expect(offline.status).toBe("offline");
    expect(offline.message).toMatch(/You are offline/);
    expect(offline.message).toMatch(/cannot be saved/);

    const disconnected = deriveConnectionState({ ...base, lastUpdateAt: base.now - 5_000 });
    expect(disconnected.status).toBe("offline");
    expect(disconnected.badgeLabel).toBe("Offline");
    expect(disconnected.message).toMatch(/Not connected to the server/);
    expect(disconnected.message).toMatch(/actions are still sent/);
  });

  it("keeps reconnecting distinct and says actions still work", () => {
    const state = deriveConnectionState({
      ...base,
      reconnecting: true,
      lastUpdateAt: base.now - 3_000
    });

    expect(state.status).toBe("reconnecting");
    expect(state.badgeLabel).toBe("Reconnecting");
    expect(state.message).toMatch(/Reconnecting/);
    expect(state.message).toMatch(/actions are still sent/);
  });

  it("calls out stale data once it is old enough to matter", () => {
    const fresh = deriveConnectionState({
      ...base,
      reconnecting: true,
      lastUpdateAt: base.now - (DEFAULT_STALE_AFTER_MS - 1)
    });
    expect(fresh.showingStaleData).toBe(false);
    expect(fresh.message).not.toMatch(/Showing data/);

    const stale = deriveConnectionState({
      ...base,
      reconnecting: true,
      lastUpdateAt: base.now - DEFAULT_STALE_AFTER_MS
    });
    expect(stale.showingStaleData).toBe(true);
    expect(stale.message).toMatch(/Showing data from 10s ago\./);

    const minutes = deriveConnectionState({
      ...base,
      reconnecting: true,
      lastUpdateAt: base.now - 4 * 60_000
    });
    expect(minutes.message).toMatch(/Showing data from 4m ago\./);
  });

  it("tolerates never having received data", () => {
    const state = deriveConnectionState({ ...base, reconnecting: true });

    expect(state.staleAgeMs).toBeNull();
    expect(state.showingStaleData).toBe(false);
    expect(state.message).not.toMatch(/Showing data/);
  });

  it("ignores a timestamp from the future", () => {
    const state = deriveConnectionState({ ...base, reconnecting: true, lastUpdateAt: base.now + 5_000 });

    expect(state.staleAgeMs).toBe(0);
    expect(state.showingStaleData).toBe(false);
  });
});

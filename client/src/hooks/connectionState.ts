/**
 * Connection and freshness state, derived from data the app already has.
 *
 * Audit finding: the shell showed a Live / Reconnecting / Offline badge and a
 * reconnecting banner, but nothing distinguished "the browser is offline" from
 * "the server is unreachable", and nothing said how old the visible process data
 * was. When the socket dropped, the dashboard kept rendering the last snapshot
 * with no freshness signal, so stale numbers looked live.
 *
 * This module keeps the decision pure so it can be tested without a socket, a
 * clock, or a browser.
 */

export type ConnectionStatus = "live" | "reconnecting" | "offline";

export type ConnectionInput = {
  /** `navigator.onLine`: the browser has a network interface. */
  online: boolean;
  /** The realtime socket is connected. */
  connected: boolean;
  /** The socket is retrying after a drop. */
  reconnecting: boolean;
  /** When process data was last received, or null if it never was. */
  lastUpdateAt?: number | null;
  now: number;
  /** How old data must be before it is called out. Avoids flicker on quick reconnects. */
  staleAfterMs?: number;
};

export type ConnectionState = {
  status: ConnectionStatus;
  badgeLabel: string;
  /** Empty while the connection is healthy. */
  message: string;
  /** Data age in ms, or null when nothing has arrived yet. */
  staleAgeMs: number | null;
  /** True when the age is worth mentioning in the banner. */
  showingStaleData: boolean;
};

export const DEFAULT_STALE_AFTER_MS = 10_000;

/** Compact age label: "8s", "4m", "2h". */
export function formatStaleAge(ageMs: number): string {
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h`;
}

export function deriveConnectionState({
  online,
  connected,
  reconnecting,
  lastUpdateAt = null,
  now,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
}: ConnectionInput): ConnectionState {
  const staleAgeMs = typeof lastUpdateAt === "number" ? Math.max(0, now - lastUpdateAt) : null;
  const showingStaleData = staleAgeMs !== null && staleAgeMs >= staleAfterMs;

  if (connected) {
    return { status: "live", badgeLabel: "Live", message: "", staleAgeMs, showingStaleData: false };
  }

  // The browser has no network at all: nothing can be sent, and saying "actions
  // still work" here would be wrong.
  if (!online) {
    return {
      status: "offline",
      badgeLabel: "Offline",
      message: "You are offline. Changes cannot be saved until the connection returns.",
      staleAgeMs,
      showingStaleData
    };
  }

  const base = reconnecting
    ? "Reconnecting. Live updates are paused; actions are still sent."
    : "Not connected to the server. Live updates are paused; actions are still sent.";
  const staleNote = showingStaleData ? ` Showing data from ${formatStaleAge(staleAgeMs)} ago.` : "";

  return {
    status: reconnecting ? "reconnecting" : "offline",
    badgeLabel: reconnecting ? "Reconnecting" : "Offline",
    message: `${base}${staleNote}`,
    staleAgeMs,
    showingStaleData
  };
}

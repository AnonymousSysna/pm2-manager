import { useEffect, useMemo, useState } from "react";
import { useSocket } from "./useSocket";
import { DEFAULT_STALE_AFTER_MS, deriveConnectionState } from "./connectionState";

/** Tracks `navigator.onLine`, including browsers that never fire the events. */
export function useBrowserOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" || navigator.onLine === undefined ? true : navigator.onLine
  );

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return online;
}

/**
 * Connection state for banner and badge surfaces.
 *
 * The age of the visible data is re-derived on a timer, but only while the
 * connection is unhealthy: a live socket already updates on every event, and a
 * ticking clock would re-render every page for nothing.
 */
export function useConnectionState() {
  const { connected, reconnecting, processesUpdatedAt } = useSocket();
  const online = useBrowserOnline();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connected) {
      return undefined;
    }

    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [connected]);

  return useMemo(
    () =>
      deriveConnectionState({
        online,
        connected,
        reconnecting,
        lastUpdateAt: processesUpdatedAt,
        now,
        staleAfterMs: DEFAULT_STALE_AFTER_MS
      }),
    [online, connected, reconnecting, processesUpdatedAt, now]
  );
}

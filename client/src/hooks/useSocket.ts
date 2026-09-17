/**
 * React binding for the live data layer.
 *
 * The provider used to own the socket, the delta merge, the log and alert
 * buffers, and the poll fallback. All of that now lives in `DataSyncService`,
 * which is transport-agnostic and testable on its own. What remains here is the
 * React-specific part: one service per provider, started and stopped with the
 * component, and re-read through `useSyncExternalStore` so every consumer sees
 * the same snapshot.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";
import { DataSyncService } from "../sync/DataSyncService";
import { createSocketTransport } from "../sync/socketTransport";
import type { SyncState } from "../sync/types";

const SocketContext = createContext<SyncState | null>(null);

export function readPollInterval() {
  const stored = Number(localStorage.getItem("pm2_poll_interval_ms") || 2000);
  return Number.isFinite(stored) && stored > 0 ? stored : 2000;
}

export function createDataSyncService({ pollIntervalMs }: { pollIntervalMs: number }) {
  return new DataSyncService({
    pollIntervalMs,
    createTransport: (interval) =>
      createSocketTransport({
        url: import.meta.env.VITE_API_URL || window.location.origin,
        pollIntervalMs: interval
      })
  });
}

export function SocketProvider({ children }) {
  const [pollInterval, setPollInterval] = useState(readPollInterval);
  const [service] = useState(() => createDataSyncService({ pollIntervalMs: readPollInterval() }));
  const state = useSyncExternalStore(service.subscribe, service.getState, service.getState);

  useEffect(() => {
    const syncInterval = () => {
      setPollInterval(readPollInterval());
    };

    window.addEventListener("storage", syncInterval);
    window.addEventListener("pm2:settings-updated", syncInterval);
    return () => {
      window.removeEventListener("storage", syncInterval);
      window.removeEventListener("pm2:settings-updated", syncInterval);
    };
  }, []);

  useEffect(() => {
    service.start();
    return () => {
      service.stop();
    };
  }, [service]);

  useEffect(() => {
    service.setPollIntervalMs(pollInterval);
  }, [service, pollInterval]);

  const value = useMemo(() => state, [state]);

  return createElement(SocketContext.Provider, { value }, children);
}

export function useSocket(): SyncState {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error("useSocket must be used within <SocketProvider>");
  }
  return value;
}

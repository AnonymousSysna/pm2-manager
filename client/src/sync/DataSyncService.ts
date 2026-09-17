/**
 * Transport-swappable live data service.
 *
 * Audit finding: the live process list, log buffer, alert buffer, reconnect
 * flags, and the poll fallback were all implemented inside one React effect in
 * `SocketProvider`. That made the transport part of the UI: the only way to
 * exercise a reconnect or a dropped delta was to mock `socket.io-client`, and
 * the polling fallback could not be reasoned about separately from rendering.
 *
 * This service owns the policy and the state. It takes a transport factory for
 * push updates and a `fetchProcesses` function for the polling fallback, then
 * hands `SyncState` to subscribers. React is a thin consumer, and the transport
 * can be replaced with an SSE or polling implementation without touching it.
 */
import { processes as processApi } from "../api";
import type { ApiResult } from "../api/types";
import {
  appendAlerts,
  appendCreateStep,
  appendLog,
  appendNotifications,
  applyDelta,
  applySnapshot
} from "./processStore";
import type { ProcessesSnapshot, SyncState, SyncTransport, TransportHandlers } from "./types";

export type ProcessLister = () => Promise<ApiResult<ProcessesSnapshot>>;

export type DataSyncServiceOptions = {
  /**
   * Builds a transport for the given push interval. A factory rather than an
   * instance because the interval is negotiated when the connection is opened,
   * so changing the setting reconnects.
   */
  createTransport: (pollIntervalMs: number) => SyncTransport;
  fetchProcesses?: ProcessLister;
  pollIntervalMs: number;
  /** Injectable clock, so freshness stamps are testable. */
  now?: () => number;
};

function initialState(): SyncState {
  return {
    processes: [],
    logsByProcess: {},
    alerts: [],
    notifications: [],
    createStepEvents: [],
    monitorError: "",
    connected: false,
    reconnecting: false,
    processesUpdatedAt: null
  };
}

/**
 * Polling is a fallback, not the primary path: the interval is three times the
 * user's push interval, clamped to 5-15s. A faster poll here would duplicate the
 * traffic the server is already pushing.
 */
export function pollDelayFor(pollIntervalMs: number): number {
  return Math.min(15000, Math.max(5000, pollIntervalMs * 3));
}

export class DataSyncService {
  private state: SyncState = initialState();
  private listeners = new Set<() => void>();
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollGeneration = 0;
  private createTransport: (pollIntervalMs: number) => SyncTransport;
  private transport: SyncTransport | null = null;
  private fetchProcesses: ProcessLister;
  private pollIntervalMs: number;
  private now: () => number;

  constructor({ createTransport, fetchProcesses, pollIntervalMs, now }: DataSyncServiceOptions) {
    this.createTransport = createTransport;
    this.fetchProcesses = fetchProcesses || (() => processApi.list() as Promise<ApiResult<ProcessesSnapshot>>);
    this.pollIntervalMs = pollIntervalMs;
    this.now = now || (() => Date.now());
    this.subscribe = this.subscribe.bind(this);
    this.getState = this.getState.bind(this);
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.attachTransport();
    this.startPolling();
  }

  stop(): void {
    this.running = false;
    this.stopPolling();
    this.detachTransport();
  }

  /**
   * The push interval is negotiated when the connection is created, so changing
   * the setting has to reconnect. The previous provider re-ran its whole effect
   * for the same reason.
   */
  setPollIntervalMs(pollIntervalMs: number): void {
    if (pollIntervalMs === this.pollIntervalMs) {
      return;
    }
    this.pollIntervalMs = pollIntervalMs;
    if (!this.running) {
      return;
    }
    this.detachTransport();
    this.attachTransport();
    this.startPolling();
  }

  getPollIntervalMs(): number {
    return this.pollIntervalMs;
  }

  /** Tear down for good. Used when the provider unmounts. */
  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private attachTransport(): void {
    const handlers: TransportHandlers = {
      onOpen: () => {
        this.patch({ connected: true, reconnecting: false, monitorError: "" });
      },
      onClose: () => {
        this.patch({ connected: false, reconnecting: true });
      },
      onSnapshot: (processes) => {
        this.patch({ processes: applySnapshot(processes), processesUpdatedAt: this.now() });
      },
      onDelta: (delta) => {
        this.patch({ processes: applyDelta(this.state.processes, delta), processesUpdatedAt: this.now() });
      },
      onLog: (entry) => {
        this.patch({ logsByProcess: appendLog(this.state.logsByProcess, entry) });
      },
      onAlerts: (alerts) => {
        this.patch({ alerts: appendAlerts(this.state.alerts, alerts) });
      },
      onMonitorError: (message) => {
        this.patch({ monitorError: message });
      },
      onNotifications: (notifications) => {
        this.patch({ notifications: appendNotifications(this.state.notifications, notifications) });
      },
      onCreateStep: (event) => {
        this.patch({ createStepEvents: appendCreateStep(this.state.createStepEvents, event) });
      }
    };

    const transport = this.createTransport(this.pollIntervalMs);
    this.transport = transport;
    transport.start(handlers);
  }

  private detachTransport(): void {
    const transport = this.transport;
    this.transport = null;
    transport?.stop();
  }

  private startPolling(): void {
    this.stopPolling();
    const generation = this.pollGeneration;

    const syncProcesses = async () => {
      try {
        const result = await this.fetchProcesses();
        if (generation !== this.pollGeneration || !this.running) {
          return;
        }
        if (!result?.success || !Array.isArray(result.data)) {
          return;
        }
        this.patch({ processes: applySnapshot(result.data), processesUpdatedAt: this.now() });
      } catch (_error) {
        // Push updates are the primary source; a failed fallback poll is not
        // worth surfacing on its own.
      }
    };

    syncProcesses();
    this.pollTimer = setInterval(syncProcesses, pollDelayFor(this.pollIntervalMs));
  }

  private stopPolling(): void {
    this.pollGeneration += 1;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private patch(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

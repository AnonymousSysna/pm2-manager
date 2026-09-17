/**
 * Shapes for the live data layer.
 *
 * Audit finding: `SocketProvider` owned the socket, the delta merge, the log and
 * alert buffers, the poll fallback, and the React state, all in one effect. The
 * transport was not replaceable, so nothing about the live layer could be tested
 * or swapped without a real socket, and every buffer cap lived inline in a
 * handler.
 *
 * These types split that apart: `SyncState` is the data, `SyncTransport` is how
 * it arrives. Any transport (socket.io today, SSE or polling tomorrow) only has
 * to call the handlers it is given.
 */
import type { ProcessSummary } from "../api/types";

/**
 * Server payloads arrive as unvalidated JSON, so the leaf fields stay open. The
 * names below are the fields the UI actually reads; the index signature keeps
 * new server fields usable without a client change.
 */
export type ProcessLogEntry = {
  processName: string;
  ts?: string | number;
  stream?: string;
  line?: string;
  message?: string;
  [key: string]: unknown;
};

export type MonitorAlert = {
  processName?: string;
  metric?: string;
  value?: number;
  threshold?: number;
  severity?: string;
  message?: string;
  ts?: string | number;
  [key: string]: unknown;
};

export type AppNotification = {
  id?: string;
  type?: string;
  message?: string;
  ts?: string | number;
  [key: string]: unknown;
};

export type CreateStepEvent = {
  operationId: string;
  stepId: string;
  label: string;
  status: string;
  [key: string]: unknown;
};

/** A full snapshot of process state, as pushed by `processes:update`. */
export type ProcessesSnapshot = ProcessSummary[];

/** An incremental update, as pushed by `processes:delta`. */
export type ProcessesDelta = {
  upserts: ProcessSummary[];
  removed: string[];
};

/** Everything the UI can read from the sync layer. */
export type SyncState = {
  processes: ProcessesSnapshot;
  logsByProcess: Record<string, ProcessLogEntry[]>;
  alerts: MonitorAlert[];
  notifications: AppNotification[];
  createStepEvents: CreateStepEvent[];
  monitorError: string;
  connected: boolean;
  reconnecting: boolean;
  /** When process data last arrived, or null if it never has. */
  processesUpdatedAt: number | null;
};

/** The callbacks a transport must drive. Transport-agnostic on purpose. */
export type TransportHandlers = {
  /** The transport is usable and live. */
  onOpen: () => void;
  /** The transport dropped and is retrying. */
  onClose: () => void;
  onSnapshot: (processes: ProcessesSnapshot) => void;
  onDelta: (delta: ProcessesDelta) => void;
  onLog: (entry: ProcessLogEntry) => void;
  onAlerts: (alerts: MonitorAlert[]) => void;
  onMonitorError: (message: string) => void;
  onNotifications: (notifications: AppNotification[]) => void;
  onCreateStep: (event: CreateStepEvent) => void;
};

export type SyncTransport = {
  /** Begin delivering events. Called once per start; must not be re-entrant. */
  start: (handlers: TransportHandlers) => void;
  /** Stop delivering events and release the connection. */
  stop: () => void;
};

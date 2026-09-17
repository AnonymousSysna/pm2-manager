/**
 * Pure state transitions for the live data layer.
 *
 * These are the rules that used to be inline inside `SocketProvider`'s socket
 * handlers. Keeping them pure means the merge and the buffer caps can be tested
 * without a socket, a clock, or React.
 */
import type {
  AppNotification,
  CreateStepEvent,
  MonitorAlert,
  ProcessLogEntry,
  ProcessesDelta,
  ProcessesSnapshot
} from "./types";

/** Buffers are capped so a long-lived tab cannot grow without bound. */
export const MAX_LOG_ENTRIES_PER_PROCESS = 1000;
export const MAX_ALERTS = 200;
export const MAX_NOTIFICATIONS = 400;
export const MAX_CREATE_STEPS = 200;

/** Keep the newest `limit` items. */
export function capTail<T>(items: T[], limit: number): T[] {
  return items.length > limit ? items.slice(-limit) : items;
}

/**
 * A process is keyed by name in both snapshots and deltas, so a payload without
 * one cannot be merged and is dropped rather than corrupting the list.
 */
function isNamedProcess(value: unknown): value is { name: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
}

function filterNamed(processes: unknown): ProcessesSnapshot {
  return Array.isArray(processes) ? (processes.filter(isNamedProcess) as ProcessesSnapshot) : [];
}

/**
 * Apply a full snapshot.
 *
 * Note this replaces rather than reconciles: `processes:update` is authoritative
 * for the whole list, and the previous code did the same. Delta merging is
 * `applyDelta`.
 */
export function applySnapshot(processes: unknown): ProcessesSnapshot {
  return filterNamed(processes);
}

/**
 * Apply an incremental update, preserving list order.
 *
 * Upserts of existing processes replace in place so the dashboard does not
 * reshuffle on every tick; new processes append; removals delete by name.
 */
export function applyDelta(previous: ProcessesSnapshot, delta: ProcessesDelta): ProcessesSnapshot {
  const upserts = filterNamed(delta?.upserts);
  const removed = Array.isArray(delta?.removed) ? delta.removed : [];
  const index = new Map(previous.map((item) => [item.name, item]));

  for (const proc of upserts) {
    index.set(proc.name, proc);
  }
  for (const name of removed) {
    index.delete(name);
  }

  return Array.from(index.values());
}

/** Append a log line, keeping only the newest entries for that process. */
export function appendLog(
  logsByProcess: Record<string, ProcessLogEntry[]>,
  entry: ProcessLogEntry
): Record<string, ProcessLogEntry[]> {
  const existing = logsByProcess[entry.processName] || [];
  const next = capTail([...existing, entry], MAX_LOG_ENTRIES_PER_PROCESS);
  return { ...logsByProcess, [entry.processName]: next };
}

export function appendAlerts(alerts: MonitorAlert[], incoming: MonitorAlert[]): MonitorAlert[] {
  return capTail([...alerts, ...incoming], MAX_ALERTS);
}

export function appendNotifications(
  notifications: AppNotification[],
  incoming: AppNotification[]
): AppNotification[] {
  return capTail([...notifications, ...incoming], MAX_NOTIFICATIONS);
}

export function appendCreateStep(events: CreateStepEvent[], event: CreateStepEvent): CreateStepEvent[] {
  return capTail([...events, event], MAX_CREATE_STEPS);
}

/** Drop a process's buffered output, so a deleted process leaves no residue. */
export function dropLogsFor(
  logsByProcess: Record<string, ProcessLogEntry[]>,
  processName: string
): Record<string, ProcessLogEntry[]> {
  if (!(processName in logsByProcess)) {
    return logsByProcess;
  }
  const next = { ...logsByProcess };
  delete next[processName];
  return next;
}

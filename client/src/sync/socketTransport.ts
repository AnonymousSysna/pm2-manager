/**
 * socket.io adapter for the sync layer.
 *
 * This is the only place that knows the wire protocol: event names, the shape of
 * each payload, and which ones are worth forwarding. Validation lives here so
 * the service and the store can assume clean input, and so a malformed or
 * partial payload is ignored instead of blanking the UI.
 */
import { io } from "socket.io-client";
import type { SyncTransport, TransportHandlers } from "./types";

type SocketLike = {
  on: (event: string, handler: (...args: any[]) => void) => void;
  disconnect: () => void;
  io?: {
    on: (event: string, handler: (...args: any[]) => void) => void;
  };
};

export type SocketTransportOptions = {
  url: string;
  /** Sent as the socket query, so the server can size its push interval. */
  pollIntervalMs: number;
  /** Injectable so tests can drive a fake socket instead of a real one. */
  socketFactory?: (url: string, options: Record<string, unknown>) => SocketLike;
};

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function nonEmptyString(value: unknown): string {
  return String(value ?? "").trim();
}

export function createSocketTransport({
  url,
  pollIntervalMs,
  socketFactory
}: SocketTransportOptions): SyncTransport {
  let socket: SocketLike | null = null;

  return {
    start(handlers: TransportHandlers) {
      if (socket) {
        return;
      }

      const connect = socketFactory || ((target: string, options: Record<string, unknown>) => io(target, options));
      const active = connect(url, {
        transports: ["websocket", "polling"],
        withCredentials: true,
        query: { interval: String(pollIntervalMs) }
      });
      socket = active;

      active.on("connect", () => {
        handlers.onOpen();
      });
      active.on("disconnect", () => {
        handlers.onClose();
      });
      active.on("connect_error", () => {
        handlers.onClose();
      });
      active.io?.on("reconnect_attempt", () => {
        handlers.onClose();
      });
      active.io?.on("reconnect_error", () => {
        handlers.onClose();
      });
      active.io?.on("reconnect_failed", () => {
        handlers.onClose();
      });

      active.on("processes:update", (data) => {
        if (!Array.isArray(data)) {
          return;
        }
        handlers.onSnapshot(data);
      });

      active.on("processes:delta", (payload) => {
        if (!payload || !Array.isArray(payload.upserts) || !Array.isArray(payload.removed)) {
          return;
        }
        handlers.onDelta({ upserts: payload.upserts, removed: payload.removed });
      });

      active.on("process:log", (payload) => {
        if (!payload?.processName) {
          return;
        }
        handlers.onLog(payload);
      });

      active.on("monitor:alerts", (items) => {
        if (!nonEmptyArray(items)) {
          return;
        }
        handlers.onAlerts(items);
      });

      active.on("monitor:error", (payload) => {
        const message = nonEmptyString(payload?.message);
        if (!message) {
          return;
        }
        handlers.onMonitorError(message);
      });

      active.on("notifications:new", (items) => {
        if (!nonEmptyArray(items)) {
          return;
        }
        handlers.onNotifications(items);
      });

      active.on("process:create:step", (payload) => {
        const operationId = nonEmptyString(payload?.operationId);
        const stepId = nonEmptyString(payload?.stepId);
        const label = nonEmptyString(payload?.label);
        const status = nonEmptyString(payload?.status);
        if (!operationId || !stepId || !label || !status) {
          return;
        }
        handlers.onCreateStep({ ...payload, operationId, stepId, label, status });
      });
    },

    stop() {
      const active = socket;
      socket = null;
      active?.disconnect();
    }
  };
}

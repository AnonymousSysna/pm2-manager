import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { processes as processApi } from "../api";

const SocketContext = createContext(null);

function readPollInterval() {
  const stored = Number(localStorage.getItem("pm2_poll_interval_ms") || 2000);
  return Number.isFinite(stored) && stored > 0 ? stored : 2000;
}

export function SocketProvider({ children }) {
  const [processes, setProcesses] = useState([]);
  const [logsByProcess, setLogsByProcess] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [createStepEvents, setCreateStepEvents] = useState([]);
  const [monitorError, setMonitorError] = useState("");
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [pollInterval, setPollInterval] = useState(readPollInterval());

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
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(baseUrl, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      query: { interval: String(pollInterval) }
    });

    const handleConnect = () => {
      setConnected(true);
      setReconnecting(false);
      setMonitorError("");
    };
    const handleDisconnect = () => {
      setConnected(false);
      setReconnecting(true);
    };
    const handleConnectError = () => {
      setConnected(false);
      setReconnecting(true);
    };
    const handleReconnectAttempt = () => {
      setReconnecting(true);
    };
    const handleProcessesUpdate = (data) => {
      if (Array.isArray(data)) {
        setProcesses(data);
      }
    };
    const handleProcessesDelta = (payload) => {
      if (!payload || !Array.isArray(payload.upserts) || !Array.isArray(payload.removed)) {
        return;
      }

      setProcesses((prev) => {
        const index = new Map(prev.map((item) => [item.name, item]));
        for (const proc of payload.upserts) {
          index.set(proc.name, proc);
        }
        for (const name of payload.removed) {
          index.delete(name);
        }
        return Array.from(index.values());
      });
    };
    const handleProcessLog = (payload) => {
      if (!payload?.processName) {
        return;
      }
      setLogsByProcess((prev) => {
        const existing = prev[payload.processName] || [];
        const next = [...existing, payload].slice(-1000);
        return { ...prev, [payload.processName]: next };
      });
    };
    const handleMonitorAlerts = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return;
      }
      setAlerts((prev) => [...prev, ...items].slice(-200));
    };
    const handleMonitorError = (payload) => {
      const message = String(payload?.message || "").trim();
      if (!message) {
        return;
      }
      setMonitorError(message);
    };
    const handleNotifications = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return;
      }
      setNotifications((prev) => [...prev, ...items].slice(-400));
    };
    const handleCreateStep = (payload) => {
      const operationId = String(payload?.operationId || "").trim();
      const stepId = String(payload?.stepId || "").trim();
      const label = String(payload?.label || "").trim();
      const status = String(payload?.status || "").trim();
      if (!operationId || !stepId || !label || !status) {
        return;
      }
      setCreateStepEvents((prev) => [...prev, payload].slice(-200));
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.io.on("reconnect_attempt", handleReconnectAttempt);
    socket.io.on("reconnect_error", handleReconnectAttempt);
    socket.io.on("reconnect_failed", handleReconnectAttempt);
    socket.on("processes:update", handleProcessesUpdate);
    socket.on("processes:delta", handleProcessesDelta);
    socket.on("process:log", handleProcessLog);
    socket.on("monitor:alerts", handleMonitorAlerts);
    socket.on("monitor:error", handleMonitorError);
    socket.on("notifications:new", handleNotifications);
    socket.on("process:create:step", handleCreateStep);

    return () => {
      socket.disconnect();
    };
  }, [pollInterval]);

  useEffect(() => {
    let active = true;

    const syncProcesses = async () => {
      try {
        const result = await processApi.list();
        if (!active || !result.success || !Array.isArray(result.data)) {
          return;
        }
        setProcesses(result.data);
      } catch (_error) {
        // Socket updates remain the primary source; ignore fallback polling errors.
      }
    };

    syncProcesses();
    const intervalMs = Math.min(15000, Math.max(5000, pollInterval * 3));
    const timer = setInterval(syncProcesses, intervalMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pollInterval]);

  const value = useMemo(
    () => ({
      processes,
      logsByProcess,
      alerts,
      notifications,
      createStepEvents,
      monitorError,
      connected,
      reconnecting
    }),
    [processes, logsByProcess, alerts, notifications, createStepEvents, monitorError, connected, reconnecting]
  );

  return createElement(SocketContext.Provider, { value }, children);
}

export function useSocket() {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error("useSocket must be used within <SocketProvider>");
  }
  return value;
}

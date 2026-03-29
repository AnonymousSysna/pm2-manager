// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

function readPollInterval() {
  const stored = Number(localStorage.getItem("pm2_poll_interval_ms") || 2000);
  return Number.isFinite(stored) && stored > 0 ? stored : 2000;
}

export function useSocket() {
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

    socket.on("connect", () => {
      setConnected(true);
      setReconnecting(false);
      setMonitorError("");
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setReconnecting(true);
    });
    socket.on("connect_error", () => {
      setConnected(false);
      setReconnecting(true);
    });
    socket.io.on("reconnect_attempt", () => {
      setReconnecting(true);
    });
    socket.io.on("reconnect_error", () => {
      setReconnecting(true);
    });
    socket.io.on("reconnect_failed", () => {
      setReconnecting(true);
    });

    socket.on("processes:update", (data) => {
      if (Array.isArray(data)) {
        setProcesses(data);
      }
    });

    socket.on("processes:delta", (payload) => {
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
    });

    socket.on("process:log", (payload) => {
      if (!payload?.processName) {
        return;
      }
      setLogsByProcess((prev) => {
        const existing = prev[payload.processName] || [];
        const next = [...existing, payload].slice(-1000);
        return { ...prev, [payload.processName]: next };
      });
    });

    socket.on("monitor:alerts", (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return;
      }
      setAlerts((prev) => [...prev, ...items].slice(-200));
    });
    socket.on("monitor:error", (payload) => {
      const message = String(payload?.message || "").trim();
      if (!message) {
        return;
      }
      setMonitorError(message);
    });

    socket.on("notifications:new", (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return;
      }
      setNotifications((prev) => [...prev, ...items].slice(-400));
    });
    socket.on("process:create:step", (payload) => {
      const operationId = String(payload?.operationId || "").trim();
      const stepId = String(payload?.stepId || "").trim();
      const label = String(payload?.label || "").trim();
      const status = String(payload?.status || "").trim();
      if (!operationId || !stepId || !label || !status) {
        return;
      }
      setCreateStepEvents((prev) => [...prev, payload].slice(-200));
    });

    return () => {
      socket.disconnect();
    };
  }, [pollInterval]);

  return {
    processes,
    logsByProcess,
    alerts,
    notifications,
    createStepEvents,
    monitorError,
    connected,
    reconnecting
  };
}


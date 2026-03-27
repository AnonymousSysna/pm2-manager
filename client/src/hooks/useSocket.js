import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

export function useSocket() {
  const [processes, setProcesses] = useState([]);
  const [logsByProcess, setLogsByProcess] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [connected, setConnected] = useState(false);

  const pollInterval = useMemo(() => {
    const stored = Number(localStorage.getItem("pm2_poll_interval_ms") || 2000);
    return Number.isFinite(stored) && stored > 0 ? stored : 2000;
  }, []);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(baseUrl, {
      transports: ["websocket", "polling"],
      withCredentials: true,
      query: { interval: String(pollInterval) }
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

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

    return () => {
      socket.disconnect();
    };
  }, [pollInterval]);

  return { processes, logsByProcess, alerts, connected };
}

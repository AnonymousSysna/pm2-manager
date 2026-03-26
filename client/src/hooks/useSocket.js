import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

export function useSocket() {
  const [processes, setProcesses] = useState([]);
  const [logsByProcess, setLogsByProcess] = useState({});
  const [connected, setConnected] = useState(false);

  const pollInterval = useMemo(() => {
    const stored = Number(localStorage.getItem("pm2_poll_interval_ms") || 2000);
    return Number.isFinite(stored) && stored > 0 ? stored : 2000;
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("pm2_token");
    if (!token) {
      return undefined;
    }

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(baseUrl, {
      transports: ["websocket", "polling"],
      auth: { token },
      query: { interval: String(pollInterval) }
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("processes:update", (data) => {
      if (Array.isArray(data)) {
        setProcesses(data);
      }
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

    return () => {
      socket.disconnect();
    };
  }, [pollInterval]);

  return { processes, logsByProcess, connected };
}
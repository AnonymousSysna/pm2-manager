import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";

export default function Logs() {
  const [searchParams] = useSearchParams();
  const defaultProcess = searchParams.get("process") || "";
  const [selected, setSelected] = useState(defaultProcess);
  const [lineCount, setLineCount] = useState(100);
  const [filter, setFilter] = useState("both");
  const [processOptions, setProcessOptions] = useState([]);
  const [entries, setEntries] = useState([]);
  const { logsByProcess } = useSocket();
  const containerRef = useRef(null);

  useEffect(() => {
    const loadProcesses = async () => {
      try {
        const result = await processApi.list();
        if (result.success && Array.isArray(result.data)) {
          setProcessOptions(result.data);
          if (!selected && result.data[0]) {
            setSelected(result.data[0].name);
          }
        }
      } catch (_err) {
        toast.error("Unable to load process list");
      }
    };

    loadProcesses();
  }, []);

  useEffect(() => {
    if (!selected) {
      return;
    }

    const loadLogs = async () => {
      try {
        const result = await processApi.logs(selected, lineCount);
        if (!result.success) {
          throw new Error(result.error || "Unable to fetch logs");
        }

        const stdout = (result.data.stdout || []).map((line) => ({ type: "stdout", data: line, timestamp: Date.now() }));
        const stderr = (result.data.stderr || []).map((line) => ({ type: "stderr", data: line, timestamp: Date.now() }));
        setEntries([...stdout, ...stderr].slice(-lineCount));
      } catch (error) {
        toast.error(error?.response?.data?.error || error.message || "Unable to fetch logs");
      }
    };

    loadLogs();
  }, [selected, lineCount]);

  useEffect(() => {
    if (!selected) {
      return;
    }

    const live = logsByProcess[selected] || [];
    if (live.length === 0) {
      return;
    }

    setEntries((prev) => [...prev, ...live.slice(-20)].slice(-1000));
  }, [logsByProcess, selected]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const autoScroll = localStorage.getItem("pm2_auto_scroll_logs") !== "false";
    if (autoScroll) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  const visibleEntries = useMemo(() => {
    return entries.filter((item) => filter === "both" || item.type === filter);
  }, [entries, filter]);

  const flush = async () => {
    if (!selected) {
      return;
    }
    if (!window.confirm(`Flush logs for ${selected}?`)) {
      return;
    }
    try {
      const result = await processApi.flush(selected);
      if (!result.success) {
        throw new Error(result.error || "Failed to flush logs");
      }
      toast.success("Logs flushed");
      setEntries([]);
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || "Failed to flush logs");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded bg-slate-900 p-3">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded bg-slate-800 px-3 py-2 text-sm">
          <option value="">Select process</option>
          {processOptions.map((proc) => (
            <option key={proc.name} value={proc.name}>
              {proc.name}
            </option>
          ))}
        </select>

        <select value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} className="rounded bg-slate-800 px-3 py-2 text-sm">
          {[50, 100, 200, 500].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <div className="flex gap-1">
          {[
            ["stdout", "stdout"],
            ["stderr", "stderr"],
            ["both", "both"]
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded px-3 py-2 text-sm ${filter === key ? "bg-green-600" : "bg-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button type="button" onClick={flush} className="rounded bg-rose-700 px-3 py-2 text-sm">
          Flush Logs
        </button>
        <button type="button" onClick={() => setEntries([])} className="rounded bg-slate-700 px-3 py-2 text-sm">
          Clear View
        </button>
      </div>

      <div ref={containerRef} className="h-[65vh] overflow-y-auto rounded bg-[#020817] p-4 font-mono text-sm">
        {!selected && (
          <div className="flex h-full flex-col items-center justify-center text-slate-500">
            <Terminal size={36} />
            <p className="mt-2">Select a process to view logs</p>
          </div>
        )}

        {selected && visibleEntries.length === 0 && <p className="text-slate-500">No log entries.</p>}

        {visibleEntries.map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className="mb-1">
            <span className="mr-2 text-slate-500">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
            <span className={entry.type === "stderr" ? "text-orange-300" : "text-green-300"}>{entry.data}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
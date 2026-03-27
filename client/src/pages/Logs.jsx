import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import Button from "../components/ui/Button";
import Select from "../components/ui/Select";

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
      await toast.promise(
        processApi.flush(selected).then((result) => {
          if (!result.success) {
            throw new Error(result.error || "Failed to flush logs");
          }
          return result;
        }),
        {
          loading: `Flushing logs for ${selected}...`,
          success: "Logs flushed",
          error: (error) => getErrorMessage(error, "Failed to flush logs")
        }
      );
      setEntries([]);
    } catch (_error) {
      // Toast is handled by toast.promise.
    }
  };

  return (
    <div className="space-y-4">
      <section className="page-panel flex flex-wrap items-center gap-2">
        <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-48">
          <option value="">Select process</option>
          {processOptions.map((proc) => (
            <option key={proc.name} value={proc.name}>
              {proc.name}
            </option>
          ))}
        </Select>

        <Select value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} className="w-28">
          {[50, 100, 200, 500].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>

        <div className="flex gap-1">
          {[
            ["stdout", "stdout"],
            ["stderr", "stderr"],
            ["both", "both"]
          ].map(([key, label]) => (
            <Button key={key} type="button" onClick={() => setFilter(key)} variant={filter === key ? "success" : "secondary"}>
              {label}
            </Button>
          ))}
        </div>

        <Button type="button" variant="danger" onClick={flush}>
          Flush Logs
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEntries([])}>
          Clear View
        </Button>
      </section>

      <section ref={containerRef} className="h-[65vh] overflow-y-auto rounded-lg border border-border bg-surface p-4 font-mono text-sm">
        {!selected && (
          <div className="flex h-full flex-col items-center justify-center text-text-3">
            <Terminal size={36} />
            <p className="mt-2">Select a process to view logs</p>
          </div>
        )}

        {selected && visibleEntries.length === 0 && <p className="text-text-3">No log entries.</p>}

        {visibleEntries.map((entry, index) => (
          <div key={`${entry.timestamp}-${index}`} className="mb-1">
            <span className="mr-2 text-text-3">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
            <span className={entry.type === "stderr" ? "text-warning-300" : "text-success-300"}>{entry.data}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

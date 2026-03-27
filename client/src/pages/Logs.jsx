import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import Select from "../components/ui/Select";
import Input from "../components/ui/Input";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

function levelFromLine(line) {
  const text = String(line || "").toUpperCase();
  if (text.includes("ERROR") || text.includes("FATAL")) {
    return "error";
  }
  if (text.includes("WARN")) {
    return "warn";
  }
  if (text.includes("DEBUG")) {
    return "debug";
  }
  if (text.includes("INFO")) {
    return "info";
  }
  return "plain";
}

function toCsv(entries) {
  const lines = ["timestamp,process,type,level,message"];
  for (const entry of entries) {
    const row = [
      new Date(entry.timestamp).toISOString(),
      entry.processName || "",
      entry.type || "",
      entry.level || "",
      String(entry.data || "").replaceAll('"', '""')
    ];
    lines.push(row.map((cell) => `"${cell}"`).join(","));
  }
  return lines.join("\n");
}

function downloadBlob(fileName, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export default function Logs() {
  const [searchParams] = useSearchParams();
  const defaultProcess = searchParams.get("process") || "";
  const launchSource = searchParams.get("source") || "";
  const [selected, setSelected] = useState(defaultProcess);
  const [lineCount, setLineCount] = useState(100);
  const [filter, setFilter] = useState("both");
  const [keyword, setKeyword] = useState("");
  const [combinedView, setCombinedView] = useState(false);
  const [processOptions, setProcessOptions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showCreateHint, setShowCreateHint] = useState(launchSource === "create" && Boolean(defaultProcess));
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
    if (!selected && !combinedView) {
      return;
    }

    const loadLogs = async () => {
      try {
        const targets = combinedView
          ? processOptions.map((item) => item.name).slice(0, 8)
          : [selected];

        const responses = await Promise.all(targets.map((name) => processApi.logs(name, lineCount)));
        const nextEntries = [];
        for (let i = 0; i < targets.length; i += 1) {
          const result = responses[i];
          if (!result.success) {
            continue;
          }
          const processName = targets[i];
          const stdout = (result.data.stdout || []).map((line) => ({
            processName,
            type: "stdout",
            level: levelFromLine(line),
            data: line,
            timestamp: Date.now()
          }));
          const stderr = (result.data.stderr || []).map((line) => ({
            processName,
            type: "stderr",
            level: levelFromLine(line),
            data: line,
            timestamp: Date.now()
          }));
          nextEntries.push(...stdout, ...stderr);
        }

        setEntries(
          nextEntries
            .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
            .slice(-Math.max(100, lineCount * Math.max(1, targets.length)))
        );
      } catch (error) {
        toast.error(error?.response?.data?.error || error.message || "Unable to fetch logs");
      }
    };

    loadLogs();
  }, [selected, lineCount, combinedView, processOptions, refreshNonce]);

  useEffect(() => {
    if (showCreateHint && entries.length > 0) {
      setShowCreateHint(false);
    }
  }, [showCreateHint, entries.length]);

  useEffect(() => {
    const targetNames = combinedView
      ? processOptions.map((item) => item.name)
      : selected
        ? [selected]
        : [];

    if (targetNames.length === 0) {
      return;
    }

    const incoming = [];
    for (const name of targetNames) {
      const live = logsByProcess[name] || [];
      for (const item of live.slice(-20)) {
        incoming.push({
          ...item,
          processName: item.processName || name,
          level: levelFromLine(item.data)
        });
      }
    }

    if (incoming.length === 0) {
      return;
    }

    setEntries((prev) => [...prev, ...incoming].slice(-2000));
  }, [logsByProcess, selected, combinedView, processOptions]);

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
    const normalizedKeyword = keyword.trim().toLowerCase();

    return entries.filter((item) => {
      if (filter !== "both" && item.type !== filter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return (
        String(item.data || "").toLowerCase().includes(normalizedKeyword) ||
        String(item.processName || "").toLowerCase().includes(normalizedKeyword) ||
        String(item.level || "").toLowerCase().includes(normalizedKeyword)
      );
    });
  }, [entries, filter, keyword]);

  const flush = async () => {
    if (!selected || combinedView) {
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

  const downloadTxt = () => {
    const lines = visibleEntries.map((entry) => {
      const ts = new Date(entry.timestamp).toISOString();
      return `[${ts}] [${entry.processName || "-"}] [${entry.type}] [${entry.level}] ${entry.data}`;
    });
    downloadBlob(`pm2-logs-${Date.now()}.txt`, lines.join("\n"), "text/plain;charset=utf-8");
  };

  const downloadCsv = () => {
    downloadBlob(`pm2-logs-${Date.now()}.csv`, toCsv(visibleEntries), "text/csv;charset=utf-8");
  };

  return (
    <div className="space-y-4">
      <PageIntro
        title="Logs"
        description="Stream, filter, and export process logs with consistent controls across single-process and combined views."
      />

      {showCreateHint && (
        <section className="rounded-md border border-info-500/40 bg-info-500/10 p-3 text-sm text-info-300">
          <p>Process creation request was accepted for <span className="font-semibold">{selected || defaultProcess}</span>. Waiting for first logs...</p>
          <p className="mt-1 text-xs text-text-3">
            If this stays empty, click Refresh Logs and check process status on Dashboard.
          </p>
        </section>
      )}

      <section className="page-panel grid gap-2 md:grid-cols-2 xl:grid-cols-6">
        <Select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full" disabled={combinedView}>
          <option value="">Select process</option>
          {processOptions.map((proc) => (
            <option key={proc.name} value={proc.name}>
              {proc.name}
            </option>
          ))}
        </Select>

        <Select value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} className="w-full">
          {[50, 100, 200, 500].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>

        <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search logs" className="w-full xl:col-span-2" />

        <div className="flex flex-wrap gap-1">
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

        <label className="flex items-center gap-2 text-sm text-text-2">
          <Checkbox checked={combinedView} onChange={(e) => setCombinedView(e.target.checked)} />
          Combined view
        </label>

        <Button type="button" variant="danger" onClick={flush} disabled={combinedView || !selected}>
          Flush Logs
        </Button>
        <Button type="button" variant="secondary" onClick={() => setEntries([])}>
          Clear View
        </Button>
        <Button type="button" variant="secondary" onClick={downloadTxt}>
          Download .txt
        </Button>
        <Button type="button" variant="secondary" onClick={downloadCsv}>
          Download .csv
        </Button>
        <Button type="button" variant="secondary" onClick={() => setRefreshNonce((value) => value + 1)}>
          Refresh Logs
        </Button>
      </section>

      <section ref={containerRef} className="h-log-viewer overflow-y-auto rounded-lg border border-border bg-surface p-3 font-mono text-xs sm:p-4 sm:text-sm">
        <PanelHeader title="Log Stream" className="mb-3 font-sans" />
        {!selected && !combinedView && (
          <div className="flex h-full flex-col items-center justify-center text-text-3">
            <Terminal size={36} />
            <p className="mt-2">Select a process to view logs</p>
          </div>
        )}

        {(selected || combinedView) && visibleEntries.length === 0 && (
          <p className="text-text-3">
            No log entries yet. The process may still be starting, or it may not be writing to stdout/stderr.
          </p>
        )}

        {visibleEntries.map((entry, index) => {
          const levelClass = {
            error: "text-danger-300",
            warn: "text-warning-300",
            info: "text-info-300",
            debug: "text-text-3",
            plain: entry.type === "stderr" ? "text-warning-300" : "text-success-300"
          }[entry.level || "plain"];

          return (
            <div key={`${entry.timestamp}-${index}-${entry.processName || "p"}`} className="mb-1">
              <span className="mr-2 text-text-3">[{new Date(entry.timestamp).toLocaleTimeString()}]</span>
              <span className="mr-2 text-xs text-brand-400">{entry.processName || "-"}</span>
              <span className={`mr-2 text-xs uppercase ${levelClass}`}>{entry.level || "plain"}</span>
              <span className={levelClass}>{entry.data}</span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

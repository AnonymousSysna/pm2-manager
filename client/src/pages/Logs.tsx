// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import InsetPanel from "../components/ui/InsetPanel";
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

function normalizeTimestamp(value, fallbackTimestamp) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallbackTimestamp;
}

function normalizeHistoricalLine(line, fallbackTimestamp) {
  if (line && typeof line === "object") {
    const message = line.data ?? line.message ?? line.line ?? "";
    return {
      data: String(message),
      timestamp: normalizeTimestamp(line.timestamp ?? line.ts ?? line.time, fallbackTimestamp)
    };
  }

  const text = String(line || "");
  const timestampMatch = text.match(
    /^\s*\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*(.*)$/
  );
  if (timestampMatch) {
    const parsed = Date.parse(timestampMatch[1]);
    if (Number.isFinite(parsed)) {
      return {
        data: timestampMatch[2] || text,
        timestamp: parsed
      };
    }
  }

  return {
    data: text,
    timestamp: fallbackTimestamp
  };
}

function socketEntryKey(entry) {
  return `${String(entry?.timestamp ?? "")}|${String(entry?.type ?? "")}|${String(entry?.data ?? "")}`;
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
  const [combinedTargets, setCombinedTargets] = useState([]);
  const [processOptions, setProcessOptions] = useState([]);
  const [entries, setEntries] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showCreateHint, setShowCreateHint] = useState(launchSource === "create" && Boolean(defaultProcess));
  const [createSummary, setCreateSummary] = useState(null);
  const { logsByProcess, processes, connected } = useSocket();
  const containerRef = useRef(null);
  const liveCursorRef = useRef(new Map());

  useEffect(() => {
    if (launchSource !== "create" || !defaultProcess) {
      return;
    }
    try {
      const raw = sessionStorage.getItem("pm2_last_create");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.processName !== defaultProcess) {
        return;
      }
      setCreateSummary(parsed);
    } catch (_error) {
      // Ignore parse issues.
    }
  }, [launchSource, defaultProcess]);

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
      setLogsLoading(true);
      try {
        const targets = combinedView
          ? (combinedTargets.length > 0 ? combinedTargets : processOptions.map((item) => item.name)).slice(0, 12)
          : [selected];

        const responses = await Promise.all(targets.map((name) => processApi.logs(name, lineCount)));
        const nextEntries = [];
        const nextCursor = new Map();
        let fallbackTimestamp = Date.now();
        for (let i = 0; i < targets.length; i += 1) {
          const result = responses[i];
          if (!result.success) {
            continue;
          }
          const processName = targets[i];
          const stdout = (result.data.stdout || []).map((line) => {
            const normalized = normalizeHistoricalLine(line, fallbackTimestamp);
            fallbackTimestamp += 1;
            return {
              processName,
              type: "stdout",
              level: levelFromLine(normalized.data),
              data: normalized.data,
              timestamp: normalized.timestamp
            };
          });
          const stderr = (result.data.stderr || []).map((line) => {
            const normalized = normalizeHistoricalLine(line, fallbackTimestamp);
            fallbackTimestamp += 1;
            return {
              processName,
              type: "stderr",
              level: levelFromLine(normalized.data),
              data: normalized.data,
              timestamp: normalized.timestamp
            };
          });
          nextEntries.push(...stdout, ...stderr);

          const live = logsByProcess[processName] || [];
          if (live.length > 0) {
            nextCursor.set(processName, socketEntryKey(live[live.length - 1]));
          }
        }

        liveCursorRef.current = nextCursor;
        setEntries(nextEntries.slice(-Math.max(100, lineCount * Math.max(1, targets.length))));
      } catch (error) {
        toast.error(error?.response?.data?.error || error.message || "Unable to fetch logs");
      } finally {
        setLogsLoading(false);
      }
    };

    loadLogs();
  }, [selected, lineCount, combinedView, combinedTargets, processOptions, refreshNonce]);

  useEffect(() => {
    if (showCreateHint && entries.length > 0) {
      setShowCreateHint(false);
    }
  }, [showCreateHint, entries.length]);

  useEffect(() => {
    liveCursorRef.current = new Map();
  }, [selected, combinedView, processOptions]);

  useEffect(() => {
    const targetNames = combinedView
      ? combinedTargets.length > 0 ? combinedTargets : processOptions.map((item) => item.name)
      : selected
        ? [selected]
        : [];

    if (targetNames.length === 0) {
      return;
    }

    const incoming = [];
    for (const name of targetNames) {
      const live = logsByProcess[name] || [];
      if (live.length === 0) {
        continue;
      }

      const cursor = liveCursorRef.current.get(name);
      if (!cursor) {
        liveCursorRef.current.set(name, socketEntryKey(live[live.length - 1]));
        continue;
      }

      let startIndex = -1;
      for (let i = live.length - 1; i >= 0; i -= 1) {
        if (socketEntryKey(live[i]) === cursor) {
          startIndex = i;
          break;
        }
      }

      const nextItems = startIndex >= 0 ? live.slice(startIndex + 1) : live.slice(-1);
      for (const item of nextItems) {
        incoming.push({
          ...item,
          processName: item.processName || name,
          level: levelFromLine(item.data)
        });
      }

      liveCursorRef.current.set(name, socketEntryKey(live[live.length - 1]));
    }

    if (incoming.length === 0) {
      return;
    }

    setEntries((prev) => [...prev, ...incoming].slice(-2000));
  }, [logsByProcess, selected, combinedView, combinedTargets, processOptions]);

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

  const hasActiveFilter = filter !== "both" || keyword.trim().length > 0;

  const selectedProcessStatus = useMemo(() => {
    if (!selected) {
      return null;
    }
    const item = processes.find((proc) => proc.name === selected);
    if (!item) {
      return null;
    }
    return {
      status: item.status || "unknown",
      restarts: item.restarts ?? 0,
      pid: item.pid ?? null,
      cpu: item.cpu ?? 0,
      memory: item.memory ?? 0
    };
  }, [processes, selected]);

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
        <Banner tone="info" className="text-base">
          <p>Process creation request was accepted for <span className="font-semibold">{selected || defaultProcess}</span>. Waiting for first logs...</p>
          <p className="mt-1 text-xs text-text-3">
            If this stays empty, click Refresh Logs and check process status on Dashboard.
          </p>
        </Banner>
      )}

      {launchSource === "create" && selected && (
        <Banner tone="neutral" className="text-base">
          <p className="text-text-2">
            Socket:{" "}
            <span className={connected ? "text-success-300" : "text-warning-300"}>
              {connected ? "connected" : "disconnected"}
            </span>
            {" | "}
            Process:{" "}
            <span className="text-text-1">{selected}</span>
            {" | "}
            Status:{" "}
            <span className="text-brand-400">{selectedProcessStatus?.status || "not found yet"}</span>
          </p>
          {selectedProcessStatus && (
            <p className="mt-1 text-xs text-text-3">
              PID: {selectedProcessStatus.pid || "-"} | Restarts: {selectedProcessStatus.restarts} | CPU: {selectedProcessStatus.cpu}% | Memory: {Math.round((selectedProcessStatus.memory || 0) / 1024 / 1024)}MB
            </p>
          )}
          {Array.isArray(createSummary?.details?.steps) && createSummary.details.steps.length > 0 && (
            <InsetPanel className="mt-2" padding="sm">
              <p className="text-xs font-semibold text-text-2">Create Steps</p>
              <div className="mt-1 space-y-1 text-xs text-text-3">
                {createSummary.details.steps.map((step, idx) => (
                  <p key={`${step.label}-${idx}`}>
                    {step.success === false ? "x" : "ok"} {step.label}
                    {Number.isFinite(step.durationMs) ? ` (${Math.round(step.durationMs / 1000)}s)` : ""}
                  </p>
                ))}
              </div>
            </InsetPanel>
          )}
        </Banner>
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

      {combinedView && (
        <section className="page-panel">
          <PanelHeader title="Combined Targets (up to 12)" className="mb-2" />
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            {processOptions.map((proc) => (
              <label key={proc.name} className="flex items-center gap-2 text-text-2">
                <Checkbox
                  checked={combinedTargets.includes(proc.name)}
                  onChange={(e) => {
                    setCombinedTargets((prev) => {
                      if (e.target.checked) {
                        return Array.from(new Set([...prev, proc.name])).slice(0, 12);
                      }
                      return prev.filter((name) => name !== proc.name);
                    });
                  }}
                />
                {proc.name}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setCombinedTargets([])}>
              Use all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCombinedTargets(processOptions.map((item) => item.name).slice(0, 12))}
            >
              Select first 12
            </Button>
          </div>
        </section>
      )}

      <section ref={containerRef} className="h-log-viewer overflow-y-auto rounded-xl border border-border bg-surface p-3 font-mono text-sm sm:p-4 sm:text-base">
        <PanelHeader title="Log Stream" className="mb-3 font-sans" />
        {!selected && !combinedView && (
          <div className="flex h-full flex-col items-center justify-center text-text-3">
            <Terminal size={36} />
            <p className="mt-2">Select a process to view logs</p>
          </div>
        )}

        {(selected || combinedView) && visibleEntries.length === 0 && (
          <p className="text-text-3">
            {logsLoading && "Loading log entries..."}
            {!logsLoading && hasActiveFilter && entries.length > 0 && "No logs match your current filter."}
            {!logsLoading && (!hasActiveFilter || entries.length === 0) && "Waiting for logs from the selected process."}
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



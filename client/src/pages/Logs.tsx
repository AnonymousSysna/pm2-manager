import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes as processApi } from "../api";
import { describeApiError } from "../lib/apiError";
import { useSocket } from "../hooks/useSocket";
import Banner from "../components/ui/Banner";
import DataLoadError from "../components/DataLoadError";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import InsetPanel from "../components/ui/InsetPanel";
import { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";
import StatusText from "../components/ui/StatusText";
import { Eyebrow } from "../components/ui/Typography";

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
  const [logsError, setLogsError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showCreateHint, setShowCreateHint] = useState(launchSource === "create" && Boolean(defaultProcess));
  const [createSummary, setCreateSummary] = useState(null);
  const [flushConfirmOpen, setFlushConfirmOpen] = useState(false);
  const { logsByProcess, processes, connected } = useSocket();
  const containerRef = useRef(null);
  const liveCursorRef = useRef(new Map());
  const logsRequestIdRef = useRef(0);

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
      logsRequestIdRef.current += 1;
      setLogsLoading(false);
      return;
    }

    const requestId = logsRequestIdRef.current + 1;
    logsRequestIdRef.current = requestId;
    let active = true;

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
        let failedTargets = 0;
        for (let i = 0; i < targets.length; i += 1) {
          const result = responses[i];
          if (!result.success) {
            failedTargets += 1;
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

        if (!active || logsRequestIdRef.current !== requestId) {
          return;
        }
        liveCursorRef.current = nextCursor;
        setEntries(nextEntries.slice(-Math.max(100, lineCount * Math.max(1, targets.length))));
        if (failedTargets === 0) {
          setLogsError("");
        } else if (failedTargets === targets.length) {
          // Every target failed, so an empty stream would be a lie.
          setLogsError(responses.find((result) => !result.success)?.error || "Could not load logs.");
        }
      } catch (error) {
        if (!active || logsRequestIdRef.current !== requestId) {
          return;
        }
        // Keep the failure on the stream instead of "Waiting.", which otherwise
        // means both "nothing has been written yet" and "the read failed".
        setLogsError(describeApiError(error));
      } finally {
        if (active && logsRequestIdRef.current === requestId) {
          setLogsLoading(false);
        }
      }
    };

    loadLogs();
    return () => {
      active = false;
    };
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
      setFlushConfirmOpen(false);
    } catch {}
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

  const closeExportMenu = (event) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  return (
    <div className="space-y-4">
      <PageIntro
        title="Logs"
      />

      {showCreateHint && (
        <Banner tone="info" className="text-base">
          <p>Process creation request was accepted for <span className="font-semibold">{selected || defaultProcess}</span>. Waiting...</p>
        </Banner>
      )}

      {launchSource === "create" && selected && (
        <Banner tone="neutral" className="text-base">
          <p className="text-text-2">
            Socket:{" "}
            <StatusText tone={connected ? "success" : "warning"}>
              {connected ? "connected" : "disconnected"}
            </StatusText>
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
              <Eyebrow>Create Steps</Eyebrow>
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

      <section className="page-panel logs-toolbar-card">
        <div className="logs-toolbar-main">
          <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Process" className="logs-control-field logs-process-select" disabled={combinedView}>
            <option value="">Select process</option>
            {processOptions.map((proc) => (
              <option key={proc.name} value={proc.name}>
                {proc.name}
              </option>
            ))}
          </select>

          <select value={lineCount} onChange={(e) => setLineCount(Number(e.target.value))} aria-label="Lines to show" className="logs-control-field logs-count-select">
            {[50, 100, 200, 500].map((value) => (
              <option key={value} value={value}>
                {value} lines
              </option>
            ))}
          </select>

          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Search logs" aria-label="Search logs" className="logs-control-field logs-search-input" />

          <div className="logs-filter-group" role="group" aria-label="Log stream filter">
            {[
              ["both", "All"],
              ["stdout", "Out"],
              ["stderr", "Err"]
            ].map(([key, label]) => (
              <Button key={key} type="button" size="sm" onClick={() => setFilter(key)} variant={filter === key ? "success" : "secondary"}>
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="logs-toolbar-actions">
          <label className="logs-combined-toggle">
            <Checkbox checked={combinedView} onChange={(e) => setCombinedView(e.target.checked)} />
            Combined
          </label>

          <div className="logs-action-buttons">
            <Button type="button" size="sm" variant="secondary" onClick={() => setRefreshNonce((value) => value + 1)}>
              Refresh
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setEntries([])}>
              Clear
            </Button>
            <details className="logs-export-menu">
              <summary aria-label="Open export options">Export</summary>
              <div className="logs-export-menu-panel" role="menu" aria-label="Export logs">
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    downloadTxt();
                    closeExportMenu(event);
                  }}
                >
                  TXT file
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    downloadCsv();
                    closeExportMenu(event);
                  }}
                >
                  CSV file
                </button>
              </div>
            </details>
            <Button type="button" size="sm" variant="danger" onClick={() => setFlushConfirmOpen(true)} disabled={combinedView || !selected}>
              Flush
            </Button>
          </div>
        </div>
      </section>

      {combinedView && (
        <section className="page-panel logs-target-panel">
          <div className="logs-target-header">Targets</div>
          <div className="logs-target-grid">
            {processOptions.map((proc) => (
              <label key={proc.name} className="logs-target-chip">
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
                <span className="truncate">{proc.name}</span>
              </label>
            ))}
          </div>
          <div className="logs-target-actions">
            <Button type="button" size="sm" variant="secondary" onClick={() => setCombinedTargets([])}>
              Use all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCombinedTargets(processOptions.map((item) => item.name).slice(0, 12))}
            >
              First 12
            </Button>
          </div>
        </section>
      )}

      {flushConfirmOpen && selected && (
        <ConfirmDialog
          title="Flush Logs"
          description={`Flush stored stdout and stderr logs for ${selected}? This clears the persisted log files for that process.`}
          confirmLabel="Flush Logs"
          onClose={() => setFlushConfirmOpen(false)}
          onConfirm={flush}
        />
      )}

      <section className="page-panel logs-stream-panel">
        <div className="logs-stream-header">
          <PanelHeader title="Log Stream" className="font-sans" />
          <div className="logs-stream-meta">
            <span>{visibleEntries.length} lines</span>
            <span>{combinedView ? "Combined" : selected || "No process"}</span>
            <StatusText tone={connected ? "success" : "warning"}>{connected ? "live" : "offline"}</StatusText>
          </div>
        </div>

        <div ref={containerRef} className="logs-stream-body">
          {!selected && !combinedView && (
            <div className="logs-empty-state">
              <Terminal size={28} />
              <p>Select a process.</p>
            </div>
          )}

          {(selected || combinedView) && visibleEntries.length === 0 && (
            <>
              {logsLoading && <LogsViewerSkeleton />}
              {!logsLoading && logsError && (
                <DataLoadError message={logsError} onRetry={() => setRefreshNonce((value) => value + 1)} />
              )}
              {!logsLoading && !logsError && hasActiveFilter && entries.length > 0 && (
                <p className="text-text-3">No matches.</p>
              )}
              {!logsLoading && !logsError && (!hasActiveFilter || entries.length === 0) && <p className="text-text-3">Waiting.</p>}
            </>
          )}

          {visibleEntries.map((entry, index) => {
            const levelTone = {
              error: "danger",
              warn: "warning",
              info: "info",
              debug: "neutral",
              plain: entry.type === "stderr" ? "warning" : "success"
            }[entry.level || "plain"];

            return (
              <div key={`${entry.timestamp}-${index}-${entry.processName || "p"}`} className="logs-line">
                <span className="logs-line-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span className="logs-line-process">{entry.processName || "-"}</span>
                <StatusText tone={levelTone} className="logs-line-level">{entry.level || "plain"}</StatusText>
                <StatusText tone={levelTone} className="logs-line-message">{entry.data}</StatusText>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function LogsViewerSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="flex items-center gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}



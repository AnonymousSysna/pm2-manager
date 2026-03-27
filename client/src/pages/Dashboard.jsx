import { useEffect, useMemo, useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  Undo2,
  ScrollText,
  Trash2,
  Download,
  Hammer,
  AlertTriangle,
  Rocket,
  ListChecks,
  X
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import ProcessDetailModal from "../components/ProcessDetailModal";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import ProgressBar from "../components/ui/ProgressBar";
import Select from "../components/ui/Select";

function bytesToMB(value) {
  return `${(Number(value || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function uptimeLabel(ms) {
  if (!ms || ms < 0) {
    return "-";
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}h ${m}m ${s}s`;
}

function durationLabel(ms) {
  if (!ms || ms <= 0) {
    return "0m";
  }
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function toPath(points, width, height, accessor) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  const values = points.map(accessor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const rawY = accessor(point);
      const y = height - ((rawY - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function SparkLine({ points, accessor, stroke }) {
  const width = 420;
  const height = 120;
  const path = toPath(points, width, height, accessor);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full rounded border border-border bg-surface-2">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { processes, alerts } = useSocket();
  const [loadingAction, setLoadingAction] = useState({});
  const [query, setQuery] = useState("");
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [processMeta, setProcessMeta] = useState({});
  const [chartProcess, setChartProcess] = useState("");
  const [historyPoints, setHistoryPoints] = useState([]);
  const [monitoringSummary, setMonitoringSummary] = useState({});
  const [selectedNames, setSelectedNames] = useState({});
  const [editingMetaProcess, setEditingMetaProcess] = useState(null);
  const [metaForm, setMetaForm] = useState({
    dependencies: "",
    cpuThreshold: "",
    memoryThreshold: ""
  });
  const [metaSaving, setMetaSaving] = useState(false);
  const [dotEnvByProcess, setDotEnvByProcess] = useState({});
  const [editingDotEnvProcess, setEditingDotEnvProcess] = useState(null);
  const [dotEnvFields, setDotEnvFields] = useState([]);
  const [dotEnvLoading, setDotEnvLoading] = useState(false);
  const [dotEnvSaving, setDotEnvSaving] = useState(false);

  const refreshCatalog = async () => {
    try {
      const [catalogResult, summaryResult] = await Promise.all([
        processApi.catalog(),
        processApi.monitoringSummary()
      ]);

      if (catalogResult.success) {
        setProcessMeta(catalogResult.data.meta || {});
        const availability = {};
        for (const item of catalogResult.data.processes || []) {
          availability[item.name] = Boolean(item.hasDotEnvFile);
        }
        setDotEnvByProcess(availability);
      }

      if (summaryResult.success && Array.isArray(summaryResult.data)) {
        const byName = {};
        for (const item of summaryResult.data) {
          byName[item.name] = item;
        }
        setMonitoringSummary(byName);
      }
    } catch (_error) {
      // Skip noisy toast for polling refresh.
    }
  };

  useEffect(() => {
    refreshCatalog();
    const timer = setInterval(refreshCatalog, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!chartProcess && processes[0]?.name) {
      setChartProcess(processes[0].name);
    }
  }, [processes, chartProcess]);

  useEffect(() => {
    if (!chartProcess) {
      setHistoryPoints([]);
      return;
    }

    processApi
      .metrics(chartProcess, 180)
      .then((result) => {
        if (result.success && Array.isArray(result.data)) {
          setHistoryPoints(result.data);
        }
      })
      .catch(() => {
        setHistoryPoints([]);
      });
  }, [chartProcess]);

  useEffect(() => {
    if (!selectedProcess?.name) {
      return;
    }

    const live = processes.find((item) => item.name === selectedProcess.name);
    if (!live) {
      return;
    }

    setSelectedProcess((prev) => {
      if (!prev) {
        return prev;
      }
      if (
        prev.cpu === live.cpu &&
        prev.memory === live.memory &&
        prev.status === live.status &&
        prev.restarts === live.restarts
      ) {
        return prev;
      }
      return { ...prev, ...live };
    });
  }, [processes, selectedProcess?.name]);

  useEffect(() => {
    const known = new Set(processes.map((proc) => proc.name));
    setSelectedNames((prev) => {
      const next = {};
      Object.entries(prev).forEach(([name, isSelected]) => {
        if (isSelected && known.has(name)) {
          next[name] = true;
        }
      });
      return next;
    });
  }, [processes]);

  const openDetails = async (proc) => {
    try {
      const result = await processApi.get(proc.name);
      setSelectedProcess({
        ...proc,
        details: result.success ? result.data : null
      });
    } catch (_error) {
      setSelectedProcess(proc);
    }
  };

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return processes;
    }

    return processes.filter(
      (item) =>
        item.name?.toLowerCase().includes(normalized) ||
        item.status?.toLowerCase().includes(normalized)
    );
  }, [processes, query]);

  const stats = useMemo(() => {
    const online = processes.filter((p) => p.status === "online").length;
    const stopped = processes.filter((p) => p.status === "stopped").length;
    const errored = processes.filter((p) => p.status === "errored").length;
    return { total: processes.length, online, stopped, errored };
  }, [processes]);

  const selectedCount = useMemo(
    () => Object.values(selectedNames).filter(Boolean).length,
    [selectedNames]
  );

  const callAction = async (action, name) => {
    const confirmed = action !== "delete" || window.confirm(`Delete process ${name}?`);
    if (!confirmed) {
      return;
    }

    setLoadingAction((prev) => ({ ...prev, [`${name}:${action}`]: true }));
    try {
      let actionPayload = undefined;
      if (action === "deploy") {
        const branch = window.prompt("Deploy branch (leave blank for current branch)", "") ?? "";
        const installDependencies = window.confirm("Run npm install during deploy?");
        const runBuild = window.confirm("Run npm run build during deploy?");
        actionPayload = { branch, installDependencies, runBuild, restartMode: "restart" };
      }
      if (action === "rollback") {
        const commitsResult = await processApi.gitCommits(name, 10);
        const commits = commitsResult?.success ? commitsResult.data?.commits || [] : [];
        const commitChoices = commits
          .slice(0, 5)
          .map((item) => `${item.shortHash} ${item.subject}`)
          .join("\n");
        const targetCommit = (window.prompt(
          `Rollback target commit (leave blank for previous commit HEAD~1)\n${commitChoices ? `Recent commits:\n${commitChoices}` : ""}`,
          ""
        ) ?? "").trim();
        actionPayload = { targetCommit, restartMode: "restart" };
      }

      const handlers = {
        start: processApi.start,
        stop: processApi.stop,
        restart: processApi.restart,
        reload: processApi.reload,
        npmInstall: processApi.npmInstall,
        npmBuild: processApi.npmBuild,
        deploy: (processName) => processApi.deploy(processName, actionPayload || {}),
        rollback: (processName) => processApi.rollback(processName, actionPayload || {}),
        delete: processApi.delete
      };
      const actionLabel = {
        start: "Start",
        stop: "Stop",
        restart: "Restart",
        reload: "Reload",
        npmInstall: "NPM install",
        npmBuild: "NPM build",
        deploy: "Deploy",
        rollback: "Rollback",
        delete: "Delete"
      }[action] || action;

      await toast.promise(
        handlers[action](name).then((result) => {
          if (!result.success) {
            throw new Error(result.error || `Failed to ${action}`);
          }
          return result;
        }),
        {
          loading: `${actionLabel} in progress...`,
          success: `${actionLabel} completed for ${name}`,
          error: (error) => getErrorMessage(error, `Failed to ${action}`)
        }
      );
      refreshCatalog();
    } catch (_error) {
      // Toast handled by toast.promise.
    } finally {
      setLoadingAction((prev) => ({ ...prev, [`${name}:${action}`]: false }));
    }
  };

  const toggleSelected = (name, checked) => {
    setSelectedNames((prev) => {
      if (checked) {
        return { ...prev, [name]: true };
      }
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const toggleSelectAllFiltered = (checked) => {
    if (!checked) {
      setSelectedNames({});
      return;
    }
    const next = {};
    filtered.forEach((proc) => {
      next[proc.name] = true;
    });
    setSelectedNames(next);
  };

  const runBulkAction = async (action) => {
    const names = filtered.filter((proc) => selectedNames[proc.name]).map((proc) => proc.name);
    if (names.length === 0) {
      toast.error("Select at least one process");
      return;
    }

    const actionLabel = {
      start: "Start",
      stop: "Stop",
      restart: "Restart"
    }[action] || action;

    try {
      const result = await toast.promise(
        processApi.bulkAction(action, names).then((response) => {
          if (!response.success) {
            throw new Error(response.error || `Failed to ${action} selected processes`);
          }
          return response;
        }),
        {
          loading: `${actionLabel} ${names.length} process(es)...`,
          success: `${actionLabel} completed for ${names.length} process(es)`,
          error: (error) => getErrorMessage(error, `Failed to ${action} selected processes`)
        }
      );

      const failed = result?.data?.results?.filter((item) => !item.success) || [];
      if (failed.length > 0) {
        toast.error(`Failed: ${failed.map((item) => item.name).join(", ")}`);
      }
      refreshCatalog();
    } catch (_error) {
      // Toast handled above.
    }
  };

  const openDotEnvModal = async (proc) => {
    if (!dotEnvByProcess[proc.name]) {
      toast.error(`No .env file found in ${proc.name} directory`);
      return;
    }

    setEditingDotEnvProcess(proc);
    setDotEnvLoading(true);
    setDotEnvFields([]);
    try {
      const result = await processApi.getDotEnv(proc.name);
      if (!result.success) {
        throw new Error(result.error || "Unable to load .env file");
      }
      if (!result.data?.hasEnvFile) {
        throw new Error(".env file is missing for this process");
      }
      const entries = Array.isArray(result.data?.entries) ? result.data.entries : [];
      setDotEnvFields(
        entries.map((item) => ({
          key: item.key,
          value: String(item.value ?? ""),
          valueType: item.valueType || "string"
        }))
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load .env file"));
      setEditingDotEnvProcess(null);
    } finally {
      setDotEnvLoading(false);
    }
  };

  const submitDotEnvModal = async () => {
    if (!editingDotEnvProcess?.name) {
      return;
    }

    try {
      setDotEnvSaving(true);
      const values = {};
      dotEnvFields.forEach((item) => {
        values[item.key] = String(item.value ?? "");
      });

      await toast.promise(
        processApi.updateDotEnv(editingDotEnvProcess.name, values).then((response) => {
          if (!response.success) {
            throw new Error(response.error || "Unable to update .env file");
          }
          return response;
        }),
        {
          loading: `Updating .env for ${editingDotEnvProcess.name}...`,
          success: `.env updated for ${editingDotEnvProcess.name}`,
          error: (error) => getErrorMessage(error, "Failed to update .env file")
        }
      );
      setEditingDotEnvProcess(null);
      setDotEnvFields([]);
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to update .env file"));
    } finally {
      setDotEnvSaving(false);
    }
  };

  const openMetaModal = (proc) => {
    const current = processMeta[proc.name] || {};
    setEditingMetaProcess(proc);
    setMetaForm({
      dependencies: Array.isArray(current.dependencies) ? current.dependencies.join(", ") : "",
      cpuThreshold:
        current.alertThresholds?.cpu === null || current.alertThresholds?.cpu === undefined
          ? ""
          : String(current.alertThresholds.cpu),
      memoryThreshold:
        current.alertThresholds?.memoryMB === null || current.alertThresholds?.memoryMB === undefined
          ? ""
          : String(current.alertThresholds.memoryMB)
    });
  };

  const submitMetaModal = async () => {
    if (!editingMetaProcess?.name) {
      return;
    }

    const cpuThresholdValue = metaForm.cpuThreshold.trim();
    const memoryThresholdValue = metaForm.memoryThreshold.trim();

    if (cpuThresholdValue !== "" && Number.isNaN(Number(cpuThresholdValue))) {
      toast.error("CPU threshold must be a number");
      return;
    }

    if (memoryThresholdValue !== "" && Number.isNaN(Number(memoryThresholdValue))) {
      toast.error("Memory threshold must be a number");
      return;
    }

    const payload = {
      dependencies: metaForm.dependencies
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      alertThresholds: {
        cpu: cpuThresholdValue === "" ? null : Number(cpuThresholdValue),
        memoryMB: memoryThresholdValue === "" ? null : Number(memoryThresholdValue)
      }
    };

    try {
      setMetaSaving(true);
      const result = await processApi.setMeta(editingMetaProcess.name, payload);
      if (!result.success) {
        throw new Error(result.error || "Unable to update process metadata");
      }
      toast.success(`Updated metadata for ${editingMetaProcess.name}`);
      setEditingMetaProcess(null);
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to update process metadata"));
    } finally {
      setMetaSaving(false);
    }
  };

  const updateDotEnvFieldValue = (index, nextValue) => {
    setDotEnvFields((prev) =>
      prev.map((item, itemIndex) => (itemIndex === index ? { ...item, value: nextValue } : item))
    );
  };

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Total Processes" value={stats.total} tone="neutral" />
        <StatCard label="Online" value={stats.online} tone="success" />
        <StatCard label="Stopped" value={stats.stopped} tone="danger" />
        <StatCard label="Errored" value={stats.errored} tone="warning" />
      </section>

      <section>
        <div className="page-panel space-y-3">
          <h2 className="section-title">CPU / Memory History</h2>
          <Select
            value={chartProcess}
            onChange={(e) => setChartProcess(e.target.value)}
            className="w-full"
          >
            {processes.map((proc) => (
              <option key={proc.name} value={proc.name}>
                {proc.name}
              </option>
            ))}
          </Select>
          <div>
            <p className="mb-1 text-xs text-text-3">CPU %</p>
            <SparkLine points={historyPoints} accessor={(point) => Number(point.cpu || 0)} stroke="rgb(var(--color-brand-500))" />
          </div>
          <div>
            <p className="mb-1 text-xs text-text-3">Memory MB</p>
            <SparkLine
              points={historyPoints}
              accessor={(point) => Number(point.memory || 0) / 1024 / 1024}
              stroke="rgb(var(--color-info-500))"
            />
          </div>
        </div>
      </section>

      <section className="page-panel">
        <h2 className="section-title mb-2">Threshold Alerts</h2>
        {alerts.length === 0 && <p className="text-sm text-text-3">No alerts yet.</p>}
        <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
          {alerts
            .slice()
            .reverse()
            .slice(0, 20)
            .map((item, index) => (
              <div key={`${item.ts}-${index}`} className="flex items-center gap-2 rounded border border-border px-2 py-1">
                <AlertTriangle size={14} className={item.severity === "danger" ? "text-danger-300" : "text-warning-300"} />
                <span className="text-text-2">
                  {item.processName}: {item.metric}={item.value} (threshold {item.threshold})
                </span>
                <span className="ml-auto text-xs text-text-3">{new Date(item.ts).toLocaleTimeString()}</span>
              </div>
            ))}
        </div>
      </section>

      <section className="page-panel">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="section-title">Process List</h2>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or status"
            className="w-full md:w-80"
          />
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-border bg-surface-2 p-2 text-xs text-text-2">
          <ListChecks size={14} />
          <span>{selectedCount} selected</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(true)}>
            Select filtered
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(false)}>
            Clear
          </Button>
          <Button type="button" size="sm" variant="success" onClick={() => runBulkAction("start")} disabled={selectedCount === 0}>
            Start selected
          </Button>
          <Button type="button" size="sm" variant="danger" onClick={() => runBulkAction("stop")} disabled={selectedCount === 0}>
            Stop selected
          </Button>
          <Button type="button" size="sm" variant="info" onClick={() => runBulkAction("restart")} disabled={selectedCount === 0}>
            Restart selected
          </Button>
        </div>

        <div className="space-y-3 md:hidden">
          {filtered.map((proc) => {
            const summary = monitoringSummary[proc.name] || {};
            const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };

            return (
              <article key={proc.name} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-brand-500"
                      checked={Boolean(selectedNames[proc.name])}
                      onChange={(e) => toggleSelected(proc.name, e.target.checked)}
                    />
                    <button
                      type="button"
                      className="text-left font-semibold text-info-300 underline-offset-2 hover:underline"
                      onClick={() => openDetails(proc)}
                    >
                      {proc.name}
                    </button>
                  </div>
                  <StatusBadge status={proc.status} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-text-3">
                  <p>CPU: {proc.cpu}%</p>
                  <p>Memory: {bytesToMB(proc.memory)}</p>
                  <p>Uptime: {durationLabel(summary.upMs || proc.uptime || 0)}</p>
                  <p>Restarts: {proc.restarts ?? 0}</p>
                  <p className="col-span-2">
                    Anomaly: {anomaly.isAnomaly ? `score ${anomaly.score}` : "-"}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  <ActionButton
                    title="Start"
                    variant="success"
                    disabled={proc.status === "online" || loadingAction[`${proc.name}:start`]}
                    onClick={() => callAction("start", proc.name)}
                    icon={<Play size={14} />}
                  />
                  <ActionButton
                    title="Stop"
                    variant="danger"
                    disabled={proc.status === "stopped" || loadingAction[`${proc.name}:stop`]}
                    onClick={() => callAction("stop", proc.name)}
                    icon={<Square size={14} />}
                  />
                  <ActionButton
                    title="Restart"
                    variant="info"
                    disabled={loadingAction[`${proc.name}:restart`]}
                    onClick={() => callAction("restart", proc.name)}
                    icon={<RefreshCw size={14} />}
                  />
                  <ActionButton
                    title="Rollback"
                    variant="warning"
                    disabled={loadingAction[`${proc.name}:rollback`]}
                    onClick={() => callAction("rollback", proc.name)}
                    icon={<Undo2 size={14} />}
                  />
                  <ActionButton
                    title="Logs"
                    variant="secondary"
                    onClick={() => navigate(`/dashboard/logs?process=${encodeURIComponent(proc.name)}`)}
                    icon={<ScrollText size={14} />}
                  />
                  <ActionButton
                    title="Meta"
                    variant="secondary"
                    onClick={() => openMetaModal(proc)}
                    icon={<ListChecks size={14} />}
                  />
                  {dotEnvByProcess[proc.name] && (
                    <ActionButton
                      title="Edit .env"
                      variant="secondary"
                      onClick={() => openDotEnvModal(proc)}
                      icon={<ScrollText size={14} />}
                    />
                  )}
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && <p className="text-center text-sm text-text-3">No processes found.</p>}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-sm">
            <thead className="text-left text-text-3">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-500"
                    checked={filtered.length > 0 && filtered.every((proc) => Boolean(selectedNames[proc.name]))}
                    onChange={(e) => toggleSelectAllFiltered(e.target.checked)}
                  />
                </th>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">CPU%</th>
                <th className="px-2 py-2">Memory</th>
                <th className="px-2 py-2">Uptime</th>
                <th className="px-2 py-2">Downtime</th>
                <th className="px-2 py-2">Restarts</th>
                <th className="px-2 py-2">Anomaly</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((proc) => {
                const summary = monitoringSummary[proc.name] || {};
                const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };

                return (
                  <tr key={proc.name} className="border-t border-border">
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-500"
                        checked={Boolean(selectedNames[proc.name])}
                        onChange={(e) => toggleSelected(proc.name, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-3">{proc.id ?? "-"}</td>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        className="font-medium text-info-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-300"
                        onClick={() => openDetails(proc)}
                      >
                        {proc.name}
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <StatusBadge status={proc.status} />
                    </td>
                    <td className="px-2 py-3">
                      <div className="w-28">
                        <div className="mb-1 text-xs text-text-3">{proc.cpu}%</div>
                        <ProgressBar value={proc.cpu} tone="success" />
                      </div>
                    </td>
                    <td className="px-2 py-3">{bytesToMB(proc.memory)}</td>
                    <td className="px-2 py-3">{durationLabel(summary.upMs || proc.uptime || 0)}</td>
                    <td className="px-2 py-3">{durationLabel(summary.downMs || 0)}</td>
                    <td className="px-2 py-3">{proc.restarts ?? 0}</td>
                    <td className="px-2 py-3">
                      {anomaly.isAnomaly ? <Badge tone="warning">score {anomaly.score}</Badge> : <span className="text-xs text-text-3">-</span>}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-wrap gap-1">
                        <ActionButton
                          title="Start"
                          variant="success"
                          disabled={proc.status === "online" || loadingAction[`${proc.name}:start`]}
                          onClick={() => callAction("start", proc.name)}
                          icon={<Play size={14} />}
                        />
                        <ActionButton
                          title="Stop"
                          variant="danger"
                          disabled={proc.status === "stopped" || loadingAction[`${proc.name}:stop`]}
                          onClick={() => callAction("stop", proc.name)}
                          icon={<Square size={14} />}
                        />
                        <ActionButton
                          title="Restart"
                          variant="info"
                          disabled={loadingAction[`${proc.name}:restart`]}
                          onClick={() => callAction("restart", proc.name)}
                          icon={<RefreshCw size={14} />}
                        />
                        <ActionButton
                          title="Reload"
                          variant="warning"
                          disabled={proc.mode !== "cluster" || loadingAction[`${proc.name}:reload`]}
                          onClick={() => callAction("reload", proc.name)}
                          icon={<RotateCcw size={14} />}
                        />
                        <ActionButton
                          title="Logs"
                          variant="secondary"
                          onClick={() => navigate(`/dashboard/logs?process=${encodeURIComponent(proc.name)}`)}
                          icon={<ScrollText size={14} />}
                        />
                        <ActionButton
                          title="Edit Meta"
                          variant="secondary"
                          onClick={() => openMetaModal(proc)}
                          icon={<ListChecks size={14} />}
                        />
                        {dotEnvByProcess[proc.name] && (
                          <ActionButton
                            title="Edit .env"
                            variant="secondary"
                            onClick={() => openDotEnvModal(proc)}
                            icon={<ScrollText size={14} />}
                          />
                        )}
                        <ActionButton
                          title="NPM Install"
                          variant="secondary"
                          disabled={loadingAction[`${proc.name}:npmInstall`]}
                          onClick={() => callAction("npmInstall", proc.name)}
                          icon={<Download size={14} />}
                        />
                        <ActionButton
                          title="NPM Build"
                          variant="secondary"
                          disabled={loadingAction[`${proc.name}:npmBuild`]}
                          onClick={() => callAction("npmBuild", proc.name)}
                          icon={<Hammer size={14} />}
                        />
                        <ActionButton
                          title="Deploy"
                          variant="info"
                          disabled={loadingAction[`${proc.name}:deploy`]}
                          onClick={() => callAction("deploy", proc.name)}
                          icon={<Rocket size={14} />}
                        />
                        <ActionButton
                          title="Rollback"
                          variant="warning"
                          disabled={loadingAction[`${proc.name}:rollback`]}
                          onClick={() => callAction("rollback", proc.name)}
                          icon={<Undo2 size={14} />}
                        />
                        <ActionButton
                          title="Delete"
                          variant="danger"
                          disabled={loadingAction[`${proc.name}:delete`]}
                          onClick={() => callAction("delete", proc.name)}
                          icon={<Trash2 size={14} />}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-2 py-8 text-center text-text-3" colSpan={11}>
                    No processes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedProcess && (
        <ProcessDetailModal process={selectedProcess} onClose={() => setSelectedProcess(null)} onAction={callAction} />
      )}

      {editingMetaProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close metadata editor"
            onClick={() => setEditingMetaProcess(null)}
          />
          <div className="relative z-10 w-full max-w-2xl rounded-lg border border-border bg-surface p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-1">Edit Metadata: {editingMetaProcess.name}</h3>
              <Button type="button" variant="ghost" size="icon" onClick={() => setEditingMetaProcess(null)}>
                <X size={18} />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-text-3">Dependencies (comma-separated)</span>
                <Input
                  value={metaForm.dependencies}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, dependencies: e.target.value }))}
                  placeholder="redis-worker,db-sync"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-text-3">CPU alert threshold (%)</span>
                <Input
                  value={metaForm.cpuThreshold}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, cpuThreshold: e.target.value }))}
                  placeholder="80"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-text-3">Memory alert threshold (MB)</span>
                <Input
                  value={metaForm.memoryThreshold}
                  onChange={(e) => setMetaForm((prev) => ({ ...prev, memoryThreshold: e.target.value }))}
                  placeholder="512"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditingMetaProcess(null)}>
                Cancel
              </Button>
              <Button type="button" variant="success" disabled={metaSaving} onClick={submitMetaModal}>
                Save Metadata
              </Button>
            </div>
          </div>
        </div>
      )}

      {editingDotEnvProcess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close .env editor"
            onClick={() => {
              if (!dotEnvSaving) {
                setEditingDotEnvProcess(null);
              }
            }}
          />
          <div className="relative z-10 w-full max-w-3xl rounded-lg border border-border bg-surface p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-text-1">Edit .env: {editingDotEnvProcess.name}</h3>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={dotEnvSaving}
                onClick={() => setEditingDotEnvProcess(null)}
              >
                <X size={18} />
              </Button>
            </div>
            <p className="mb-2 text-xs text-text-3">Fields are inferred from existing `.env` values.</p>
            {dotEnvLoading ? (
              <div className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-3">Loading .env...</div>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border border-border bg-surface-2 p-3">
                {dotEnvFields.length === 0 && (
                  <p className="text-sm text-text-3">No editable `KEY=VALUE` lines found in `.env`.</p>
                )}
                {dotEnvFields.map((item, index) => (
                  <div key={`${item.key}-${index}`} className="grid grid-cols-1 gap-2 md:grid-cols-[220px,1fr] md:items-center">
                    <label className="text-xs font-semibold text-text-2">{item.key}</label>
                    <DotEnvValueInput
                      valueType={item.valueType}
                      value={item.value}
                      disabled={dotEnvSaving}
                      onChange={(nextValue) => updateDotEnvFieldValue(index, nextValue)}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={dotEnvSaving}
                onClick={() => setEditingDotEnvProcess(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="success"
                disabled={dotEnvLoading || dotEnvSaving}
                onClick={submitDotEnvModal}
              >
                Save .env
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = {
    success: "text-success-300",
    danger: "text-danger-300",
    warning: "text-warning-300",
    neutral: "text-text-1"
  };

  return (
    <div className="page-panel">
      <p className="text-sm text-text-3">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass[tone] || toneClass.neutral}`}>{value}</p>
    </div>
  );
}

function ActionButton({ title, icon, variant, onClick, disabled }) {
  return (
    <Button type="button" title={title} size="sm-icon" variant={variant} disabled={disabled} onClick={onClick}>
      {icon}
    </Button>
  );
}

function DotEnvValueInput({ valueType, value, onChange, disabled }) {
  if (valueType === "boolean") {
    return (
      <select
        value={String(value).toLowerCase() === "true" ? "true" : "false"}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (valueType === "integer" || valueType === "number") {
    return (
      <Input
        type="number"
        step={valueType === "integer" ? "1" : "any"}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <Input
      type="text"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function StatusBadge({ status }) {
  const map = {
    online: "success",
    stopped: "danger",
    errored: "warning"
  };

  return <Badge tone={map[status] || "neutral"}>{status || "unknown"}</Badge>;
}

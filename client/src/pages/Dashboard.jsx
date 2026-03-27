import { useEffect, useMemo, useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Trash2,
  Download,
  Hammer,
  AlertTriangle,
  Rocket
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
  const [groups, setGroups] = useState({});
  const [processMeta, setProcessMeta] = useState({});
  const [selectedGroup, setSelectedGroup] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");
  const [chartProcess, setChartProcess] = useState("");
  const [historyPoints, setHistoryPoints] = useState([]);
  const [monitoringSummary, setMonitoringSummary] = useState({});

  const refreshCatalog = async () => {
    try {
      const [catalogResult, summaryResult] = await Promise.all([
        processApi.catalog(),
        processApi.monitoringSummary()
      ]);

      if (catalogResult.success) {
        setGroups(catalogResult.data.groups || {});
        setProcessMeta(catalogResult.data.meta || {});
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
        item.status?.toLowerCase().includes(normalized) ||
        processMeta[item.name]?.group?.toLowerCase().includes(normalized) ||
        (processMeta[item.name]?.tags || []).some((tag) => tag.includes(normalized))
    );
  }, [processes, query, processMeta]);

  const stats = useMemo(() => {
    const online = processes.filter((p) => p.status === "online").length;
    const stopped = processes.filter((p) => p.status === "stopped").length;
    const errored = processes.filter((p) => p.status === "errored").length;
    return { total: processes.length, online, stopped, errored };
  }, [processes]);

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

      const handlers = {
        start: processApi.start,
        stop: processApi.stop,
        restart: processApi.restart,
        reload: processApi.reload,
        npmInstall: processApi.npmInstall,
        npmBuild: processApi.npmBuild,
        deploy: (processName) => processApi.deploy(processName, actionPayload || {}),
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

  const editMeta = async (proc) => {
    const current = processMeta[proc.name] || {};
    const group = window.prompt("Group name", current.group || "") ?? current.group ?? "";
    const tagsRaw =
      window.prompt("Tags (comma-separated)", Array.isArray(current.tags) ? current.tags.join(",") : "") ?? "";
    const dependenciesRaw =
      window.prompt(
        "Dependencies start first (comma-separated process names)",
        Array.isArray(current.dependencies) ? current.dependencies.join(",") : ""
      ) ?? "";
    const cpuThreshold =
      window.prompt("CPU alert threshold (%)", current.alertThresholds?.cpu ?? "") ?? "";
    const memoryThreshold =
      window.prompt("Memory alert threshold (MB)", current.alertThresholds?.memoryMB ?? "") ?? "";

    const payload = {
      group,
      tags: tagsRaw
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
      dependencies: dependenciesRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      alertThresholds: {
        cpu: cpuThreshold === "" ? null : Number(cpuThreshold),
        memoryMB: memoryThreshold === "" ? null : Number(memoryThreshold)
      }
    };

    try {
      const result = await processApi.setMeta(proc.name, payload);
      if (!result.success) {
        throw new Error(result.error || "Unable to update process metadata");
      }
      toast.success(`Updated metadata for ${proc.name}`);
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to update process metadata"));
    }
  };

  const saveGroup = async () => {
    const name = selectedGroup.trim();
    if (!name) {
      toast.error("Group name is required");
      return;
    }

    const members = groupMembersInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      const result = await processApi.setGroup(name, members);
      if (!result.success) {
        throw new Error(result.error || "Unable to save group");
      }
      toast.success(`Saved group ${name}`);
      setSelectedGroup("");
      setGroupMembersInput("");
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to save group"));
    }
  };

  const runGroupAction = async (groupName, action) => {
    try {
      const result = await processApi.groupAction(groupName, action);
      if (!result.success) {
        throw new Error(result.error || `Unable to ${action} group`);
      }
      const failures = (result.data?.results || []).filter((item) => !item.success);
      if (failures.length > 0) {
        toast.error(`${action} completed with ${failures.length} failures`);
      } else {
        toast.success(`${action} completed for group ${groupName}`);
      }
      refreshCatalog();
    } catch (error) {
      toast.error(getErrorMessage(error, `Unable to ${action} group`));
    }
  };

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Total Processes" value={stats.total} tone="neutral" />
        <StatCard label="Online" value={stats.online} tone="success" />
        <StatCard label="Stopped" value={stats.stopped} tone="danger" />
        <StatCard label="Errored" value={stats.errored} tone="warning" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="page-panel space-y-3">
          <h2 className="section-title">Groups & Bulk Actions</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <Input value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} placeholder="Group name" />
            <Input
              value={groupMembersInput}
              onChange={(e) => setGroupMembersInput(e.target.value)}
              placeholder="Members (api,db,worker)"
            />
          </div>
          <Button type="button" variant="secondary" onClick={saveGroup}>
            Save Group
          </Button>

          <div className="space-y-2">
            {Object.entries(groups).length === 0 && <p className="text-sm text-text-3">No groups configured.</p>}
            {Object.entries(groups).map(([groupName, members]) => (
              <div key={groupName} className="rounded border border-border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-text-1">
                    {groupName} <span className="text-text-3">({members.length})</span>
                  </p>
                  <div className="flex gap-1">
                    <ActionButton title="Start Group" variant="success" onClick={() => runGroupAction(groupName, "start")} icon={<Play size={14} />} />
                    <ActionButton title="Stop Group" variant="danger" onClick={() => runGroupAction(groupName, "stop")} icon={<Square size={14} />} />
                    <ActionButton title="Restart Group" variant="info" onClick={() => runGroupAction(groupName, "restart")} icon={<RefreshCw size={14} />} />
                  </div>
                </div>
                <p className="mt-1 text-xs text-text-3">{members.join(", ")}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="page-panel space-y-3">
          <h2 className="section-title">CPU / Memory History</h2>
          <select
            value={chartProcess}
            onChange={(e) => setChartProcess(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            {processes.map((proc) => (
              <option key={proc.name} value={proc.name}>
                {proc.name}
              </option>
            ))}
          </select>
          <div>
            <p className="mb-1 text-xs text-text-3">CPU %</p>
            <SparkLine points={historyPoints} accessor={(point) => Number(point.cpu || 0)} stroke="#22c55e" />
          </div>
          <div>
            <p className="mb-1 text-xs text-text-3">Memory MB</p>
            <SparkLine
              points={historyPoints}
              accessor={(point) => Number(point.memory || 0) / 1024 / 1024}
              stroke="#3b82f6"
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
            placeholder="Search by name, status, group, tag"
            className="w-full md:w-80"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-text-3">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Group / Tags</th>
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
                const meta = processMeta[proc.name] || {};
                const summary = monitoringSummary[proc.name] || {};
                const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };

                return (
                  <tr key={proc.name} className="border-t border-border">
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
                      <p className="text-xs text-text-2">{meta.group || "-"}</p>
                      <p className="text-xs text-text-3">{Array.isArray(meta.tags) && meta.tags.length > 0 ? meta.tags.join(",") : "-"}</p>
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
                          onClick={() => editMeta(proc)}
                          icon={<AlertTriangle size={14} />}
                        />
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
    <Button type="button" title={title} size="icon" variant={variant} disabled={disabled} onClick={onClick} className="h-7 w-7 rounded">
      {icon}
    </Button>
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

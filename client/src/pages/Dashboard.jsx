import { useEffect, useMemo, useState } from "react";
import { Play, Square, RefreshCw, RotateCcw, ScrollText, Trash2, Download, Hammer } from "lucide-react";
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

export default function Dashboard() {
  const navigate = useNavigate();
  const { processes } = useSocket();
  const [loadingAction, setLoadingAction] = useState({});
  const [query, setQuery] = useState("");
  const [selectedProcess, setSelectedProcess] = useState(null);

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

    return processes.filter((item) => item.name?.toLowerCase().includes(normalized) || item.status?.toLowerCase().includes(normalized));
  }, [processes, query]);

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
      const handlers = {
        start: processApi.start,
        stop: processApi.stop,
        restart: processApi.restart,
        reload: processApi.reload,
        npmInstall: processApi.npmInstall,
        npmBuild: processApi.npmBuild,
        delete: processApi.delete
      };
      const actionLabel = {
        start: "Start",
        stop: "Stop",
        restart: "Restart",
        reload: "Reload",
        npmInstall: "NPM install",
        npmBuild: "NPM build",
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
    } catch (_error) {
      // Toast is handled by toast.promise.
    } finally {
      setLoadingAction((prev) => ({ ...prev, [`${name}:${action}`]: false }));
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

      <section className="page-panel">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="section-title">Process List</h2>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or status"
            className="w-full md:w-72"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-text-3">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">CPU%</th>
                <th className="px-2 py-2">Memory</th>
                <th className="px-2 py-2">Uptime</th>
                <th className="px-2 py-2">Restarts</th>
                <th className="px-2 py-2">Port</th>
                <th className="px-2 py-2">Mode</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((proc) => (
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
                    <div className="w-28">
                      <div className="mb-1 text-xs text-text-3">{proc.cpu}%</div>
                      <ProgressBar value={proc.cpu} tone="success" />
                    </div>
                  </td>
                  <td className="px-2 py-3">{bytesToMB(proc.memory)}</td>
                  <td className="px-2 py-3">{uptimeLabel(proc.uptime)}</td>
                  <td className="px-2 py-3">{proc.restarts ?? 0}</td>
                  <td className="px-2 py-3">{proc.port || "-"}</td>
                  <td className="px-2 py-3">{proc.mode || "fork"}</td>
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
                        title="Delete"
                        variant="danger"
                        disabled={loadingAction[`${proc.name}:delete`]}
                        onClick={() => callAction("delete", proc.name)}
                        icon={<Trash2 size={14} />}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-2 py-8 text-center text-text-3" colSpan={10}>
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

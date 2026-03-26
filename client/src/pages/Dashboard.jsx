import { useEffect, useMemo, useState } from "react";
import { Play, Square, RefreshCw, RotateCcw, ScrollText, Trash2, Download, Hammer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { processes as processApi } from "../api";
import { useSocket } from "../hooks/useSocket";
import ProcessDetailModal from "../components/ProcessDetailModal";

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
      const result = await handlers[action](name);
      if (!result.success) {
        throw new Error(result.error || `Failed to ${action}`);
      }
      toast.success(`${action} succeeded for ${name}`);
    } catch (error) {
      toast.error(error?.response?.data?.error || error.message || `Failed to ${action}`);
    } finally {
      setLoadingAction((prev) => ({ ...prev, [`${name}:${action}`]: false }));
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Total Processes" value={stats.total} color="text-slate-100" />
        <StatCard label="Online" value={stats.online} color="text-green-400" />
        <StatCard label="Stopped" value={stats.stopped} color="text-red-400" />
        <StatCard label="Errored" value={stats.errored} color="text-yellow-400" />
      </div>

      <div className="rounded-lg bg-slate-900 p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold">Processes</h3>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or status"
            className="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm md:w-72"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-400">
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
                <tr key={proc.name} className="border-t border-slate-800">
                  <td className="px-2 py-3">{proc.id ?? "-"}</td>
                  <td className="px-2 py-3">
                    <button type="button" className="text-green-400 hover:underline" onClick={() => openDetails(proc)}>
                      {proc.name}
                    </button>
                  </td>
                  <td className="px-2 py-3">
                    <StatusBadge status={proc.status} />
                  </td>
                  <td className="px-2 py-3">
                    <div className="w-28">
                      <div className="mb-1 text-xs text-slate-300">{proc.cpu}%</div>
                      <div className="h-1.5 rounded bg-slate-800">
                        <div className="h-1.5 rounded bg-green-500" style={{ width: `${Math.min(proc.cpu || 0, 100)}%` }} />
                      </div>
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
                        disabled={proc.status === "online" || loadingAction[`${proc.name}:start`]}
                        color="bg-green-600"
                        onClick={() => callAction("start", proc.name)}
                        icon={<Play size={14} />}
                      />
                      <ActionButton
                        title="Stop"
                        disabled={proc.status === "stopped" || loadingAction[`${proc.name}:stop`]}
                        color="bg-red-600"
                        onClick={() => callAction("stop", proc.name)}
                        icon={<Square size={14} />}
                      />
                      <ActionButton
                        title="Restart"
                        disabled={loadingAction[`${proc.name}:restart`]}
                        color="bg-blue-600"
                        onClick={() => callAction("restart", proc.name)}
                        icon={<RefreshCw size={14} />}
                      />
                      <ActionButton
                        title="Reload"
                        disabled={proc.mode !== "cluster" || loadingAction[`${proc.name}:reload`]}
                        color="bg-amber-600"
                        onClick={() => callAction("reload", proc.name)}
                        icon={<RotateCcw size={14} />}
                      />
                      <ActionButton
                        title="Logs"
                        color="bg-slate-600"
                        onClick={() => navigate(`/dashboard/logs?process=${encodeURIComponent(proc.name)}`)}
                        icon={<ScrollText size={14} />}
                      />
                      <ActionButton
                        title="NPM Install"
                        disabled={loadingAction[`${proc.name}:npmInstall`]}
                        color="bg-cyan-700"
                        onClick={() => callAction("npmInstall", proc.name)}
                        icon={<Download size={14} />}
                      />
                      <ActionButton
                        title="NPM Build"
                        disabled={loadingAction[`${proc.name}:npmBuild`]}
                        color="bg-violet-700"
                        onClick={() => callAction("npmBuild", proc.name)}
                        icon={<Hammer size={14} />}
                      />
                      <ActionButton
                        title="Delete"
                        disabled={loadingAction[`${proc.name}:delete`]}
                        color="bg-rose-700"
                        onClick={() => callAction("delete", proc.name)}
                        icon={<Trash2 size={14} />}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td className="px-2 py-8 text-center text-slate-400" colSpan={10}>
                    No processes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedProcess && (
        <ProcessDetailModal process={selectedProcess} onClose={() => setSelectedProcess(null)} onAction={callAction} />
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className="rounded-lg bg-slate-900 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function ActionButton({ title, icon, color, onClick, disabled }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${color} rounded px-2 py-1 text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {icon}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    online: "bg-green-500/20 text-green-300",
    stopped: "bg-red-500/20 text-red-300",
    errored: "bg-yellow-500/20 text-yellow-300"
  };

  return <span className={`rounded-full px-2 py-1 text-xs ${map[status] || "bg-slate-700 text-slate-300"}`}>{status || "unknown"}</span>;
}

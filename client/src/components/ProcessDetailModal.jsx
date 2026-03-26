import { useEffect, useMemo, useRef, useState } from "react";
import { X, Copy, Play, Square, RefreshCw, RotateCcw, Trash2 } from "lucide-react";

const tabs = ["Overview", "Environment", "Resource Graph", "Quick Actions"];

export default function ProcessDetailModal({ process, onClose, onAction }) {
  const [tab, setTab] = useState("Overview");
  const readingsRef = useRef([]);

  useEffect(() => {
    if (!process) {
      return;
    }

    readingsRef.current = [...readingsRef.current, { cpu: process.cpu || 0, memory: process.memory || 0 }].slice(-10);
  }, [process]);

  useEffect(() => {
    const onEsc = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const details = useMemo(() => {
    const data = process?.details || {};
    const env = data.pm2_env || {};

    return {
      pid: process?.pid,
      ppid: data.pid,
      execPath: env.pm_exec_path,
      cwd: env.pm_cwd,
      nodeVersion: env.node_version,
      pm2Version: env.version,
      status: process?.status,
      restarts: process?.restarts,
      uptime: process?.uptime,
      createdAt: env.created_at,
      unstableRestarts: env.unstable_restarts,
      versioning: env.versioning,
      port: process?.port
    };
  }, [process]);

  if (!process) {
    return null;
  }

  const envVars = process?.details?.pm2_env?.env || {};
  const maxMemory = Math.max(...readingsRef.current.map((x) => x.memory || 0), 1);

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close panel" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl transform bg-slate-900 p-6 text-slate-100 shadow-xl transition-transform duration-300">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{process.name}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-800">
            <X size={20} />
          </button>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto">
          {tabs.map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => setTab(item)}
              className={`rounded px-3 py-1 text-sm ${tab === item ? "bg-green-500/20 text-green-300" : "bg-slate-800 text-slate-300"}`}
            >
              {item}
            </button>
          ))}
        </div>

        {tab === "Overview" && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(details).map(([key, value]) => (
              <div key={key} className="rounded bg-slate-800 p-2">
                <p className="text-xs uppercase text-slate-400">{key}</p>
                <p className="break-all text-slate-100">{String(value ?? "-")}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "Environment" && (
          <div className="max-h-[70vh] overflow-y-auto rounded border border-slate-700">
            {Object.entries(envVars).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[1fr,1fr,40px] items-center gap-2 border-b border-slate-800 p-2 text-xs">
                <span className="text-slate-300">{key}</span>
                <span className="truncate text-slate-100">{String(value)}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(String(value))}
                  className="rounded bg-slate-700 p-1 hover:bg-slate-600"
                >
                  <Copy size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {tab === "Resource Graph" && (
          <div className="space-y-3">
            {readingsRef.current.length === 0 && <p className="text-sm text-slate-400">No readings yet.</p>}
            {readingsRef.current.map((item, index) => (
              <div key={`${item.cpu}-${index}`} className="space-y-1 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>Sample {index + 1}</span>
                  <span>
                    CPU {item.cpu}% | MEM {(item.memory / 1024 / 1024).toFixed(1)}MB
                  </span>
                </div>
                <div className="h-2 rounded bg-slate-800">
                  <div className="h-2 rounded bg-green-500" style={{ width: `${Math.min(100, item.cpu)}%` }} />
                </div>
                <div className="h-2 rounded bg-slate-800">
                  <div className="h-2 rounded bg-blue-500" style={{ width: `${Math.min(100, (item.memory / maxMemory) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "Quick Actions" && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="rounded bg-green-600 px-3 py-2" onClick={() => onAction("start", process.name)}>
              <Play className="inline" size={16} /> Start
            </button>
            <button type="button" className="rounded bg-red-600 px-3 py-2" onClick={() => onAction("stop", process.name)}>
              <Square className="inline" size={16} /> Stop
            </button>
            <button type="button" className="rounded bg-blue-600 px-3 py-2" onClick={() => onAction("restart", process.name)}>
              <RefreshCw className="inline" size={16} /> Restart
            </button>
            <button type="button" className="rounded bg-amber-600 px-3 py-2" onClick={() => onAction("reload", process.name)}>
              <RotateCcw className="inline" size={16} /> Reload
            </button>
            <button type="button" className="col-span-2 rounded bg-rose-700 px-3 py-2" onClick={() => onAction("delete", process.name)}>
              <Trash2 className="inline" size={16} /> Delete
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
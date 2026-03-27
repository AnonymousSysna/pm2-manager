import { useEffect, useMemo, useState } from "react";
import { X, Copy, Play, Square, RefreshCw, RotateCcw, Trash2, Download, Hammer } from "lucide-react";
import toast from "../lib/toast";
import { processes as processApi } from "../api";
import Button from "./ui/Button";
import ProgressBar from "./ui/ProgressBar";

const tabs = ["Overview", "Environment", "Resource Graph", "Quick Actions"];

async function copyToClipboard(text) {
  const value = String(text ?? "");

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-1000px";
  textArea.style.left = "-1000px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

export default function ProcessDetailModal({ process, onClose, onAction }) {
  const [tab, setTab] = useState("Overview");
  const [loadingAction, setLoadingAction] = useState({});
  const [metricsPoints, setMetricsPoints] = useState([]);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    const onEsc = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    if (!process?.name) {
      return;
    }

    let active = true;
    const loadMetrics = async () => {
      try {
        setMetricsLoading(true);
        const result = await processApi.metrics(process.name, 120);
        if (active && result.success && Array.isArray(result.data)) {
          setMetricsPoints(result.data);
        }
      } catch (_error) {
        if (active) {
          setMetricsPoints([]);
        }
      } finally {
        if (active) {
          setMetricsLoading(false);
        }
      }
    };

    loadMetrics();
    const timer = setInterval(loadMetrics, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [process?.name]);

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
  const gitStatus = process?.gitStatus || null;
  const maxMemory = Math.max(...metricsPoints.map((x) => x.memory || 0), 1);
  const isOnline = process?.status === "online";
  const isStopped = process?.status === "stopped";
  const isCluster = process?.mode === "cluster";
  const canGitPull = Boolean(
    gitStatus?.isGitRepo &&
    gitStatus?.upstream &&
    Number(gitStatus?.behind || 0) > 0
  );

  const runAction = async (action, processName) => {
    setLoadingAction((prev) => ({ ...prev, [action]: true }));
    try {
      await Promise.resolve(onAction(action, processName));
    } finally {
      setLoadingAction((prev) => ({ ...prev, [action]: false }));
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close panel" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-xl border-l border-border bg-surface p-6 text-text-1 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{process.name}</h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X size={20} />
          </Button>
        </div>

        <div className="mb-4 flex gap-2 overflow-x-auto">
          {tabs.map((item) => (
            <Button key={item} type="button" onClick={() => setTab(item)} variant={tab === item ? "success" : "secondary"} size="sm">
              {item}
            </Button>
          ))}
        </div>

        {tab === "Overview" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {Object.entries(details).map(([key, value]) => (
                <div key={key} className="rounded-md border border-border bg-surface-2 p-2">
                  <p className="text-xs uppercase text-text-3">{key}</p>
                  <p className="break-all text-text-1">{String(value ?? "-")}</p>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
              <p className="mb-2 text-xs uppercase text-text-3">Git</p>
              {!gitStatus && <p className="text-text-3">Status not loaded.</p>}
              {gitStatus && !gitStatus.isGitRepo && <p className="text-text-3">Not a git repository.</p>}
              {gitStatus?.isGitRepo && (
                <div className="space-y-1 text-text-2">
                  <p>Branch: {gitStatus.branch || "-"}</p>
                  <p>Commit: {gitStatus.localShortCommit || "-"}</p>
                  <p>Upstream: {gitStatus.upstream || "-"}</p>
                  <p>
                    Sync: behind {gitStatus.behind ?? 0}, ahead {gitStatus.ahead ?? 0}
                    {gitStatus.upToDate ? " (up to date)" : ""}
                  </p>
                  <p>Working tree: {gitStatus.cleanWorkingTree ? "clean" : "has local changes"}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "Environment" && (
          <div className="max-h-[70vh] overflow-y-auto rounded-md border border-border">
            {Object.entries(envVars).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[1fr,1fr,40px] items-center gap-2 border-b border-border p-2 text-xs">
                <span className="text-text-2">{key}</span>
                <span className="truncate text-text-1">{String(value)}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={async () => {
                    try {
                      await copyToClipboard(value);
                      toast.success(`Copied ${key}`);
                    } catch (_error) {
                      toast.error("Failed to copy");
                    }
                  }}
                >
                  <Copy size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}

        {tab === "Resource Graph" && (
          <div className="space-y-3">
            {metricsLoading && <p className="text-sm text-text-3">Loading metrics history...</p>}
            {!metricsLoading && metricsPoints.length === 0 && (
              <p className="text-sm text-text-3">No metrics history yet.</p>
            )}
            {metricsPoints.map((item, index) => (
              <div key={`${item.ts}-${index}`} className="space-y-1 text-xs">
                <div className="flex justify-between text-text-2">
                  <span>{item.ts ? new Date(item.ts).toLocaleTimeString() : `Point ${index + 1}`}</span>
                  <span>
                    CPU {item.cpu}% | MEM {(item.memory / 1024 / 1024).toFixed(1)}MB
                  </span>
                </div>
                <ProgressBar value={item.cpu} tone="success" />
                <ProgressBar value={(item.memory / maxMemory) * 100} tone="info" />
              </div>
            ))}
          </div>
        )}

        {tab === "Quick Actions" && (
          <div className="grid grid-cols-2 gap-2">
            <QuickAction
              label="Start"
              icon={Play}
              variant="success"
              disabled={isOnline || loadingAction.start}
              onClick={() => runAction("start", process.name)}
            />
            <QuickAction
              label="Stop"
              icon={Square}
              variant="danger"
              disabled={isStopped || loadingAction.stop}
              onClick={() => runAction("stop", process.name)}
            />
            <QuickAction
              label="Restart"
              icon={RefreshCw}
              variant="info"
              disabled={loadingAction.restart}
              onClick={() => runAction("restart", process.name)}
            />
            <QuickAction
              label="Reload"
              icon={RotateCcw}
              variant="warning"
              disabled={!isCluster || !isOnline || loadingAction.reload}
              onClick={() => runAction("reload", process.name)}
            />
            <QuickAction
              label="NPM Install"
              icon={Download}
              variant="secondary"
              disabled={loadingAction.npmInstall}
              onClick={() => runAction("npmInstall", process.name)}
            />
            <QuickAction
              label="NPM Build"
              icon={Hammer}
              variant="secondary"
              disabled={loadingAction.npmBuild}
              onClick={() => runAction("npmBuild", process.name)}
            />
            <QuickAction
              label="Git Pull"
              icon={Download}
              variant="secondary"
              disabled={!canGitPull || loadingAction.gitPull}
              onClick={() => runAction("gitPull", process.name)}
            />
            <Button
              type="button"
              className="col-span-2"
              variant="danger"
              disabled={loadingAction.delete}
              onClick={() => runAction("delete", process.name)}
            >
              <Trash2 size={16} /> Delete
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

function QuickAction({ label, icon: Icon, variant, onClick, disabled }) {
  return (
    <Button type="button" variant={variant} disabled={disabled} onClick={onClick}>
      <Icon size={16} /> {label}
    </Button>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Copy, Play, Square, RefreshCw, RotateCcw, Trash2, Download, Hammer, ShieldAlert, History, AlarmClock } from "lucide-react";
import toast from "../lib/toast";
import { processes as processApi } from "../api";
import Button from "./ui/Button";
import Badge from "./ui/Badge";
import Modal from "./ui/Modal";
import ProgressBar from "./ui/ProgressBar";
import TabGroup from "./ui/TabGroup";
import { Skeleton } from "./ui/Skeleton";

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

const SENSITIVE_ENV_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|private|credential|auth|pwd)/i;

function isSensitiveEnvKey(key) {
  return SENSITIVE_ENV_KEY_PATTERN.test(String(key || ""));
}

export default function ProcessDetailModal({ process, onClose, onAction, onViewDeployHistory }) {
  const [tab, setTab] = useState("Overview");
  const [loadingAction, setLoadingAction] = useState({});
  const [metricsPoints, setMetricsPoints] = useState([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [revealSensitiveEnv, setRevealSensitiveEnv] = useState(false);

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

  useEffect(() => {
    setRevealSensitiveEnv(false);
  }, [process?.name]);

  const details = useMemo(() => {
    const data = process?.details || {};
    const env = data.pm2_env || {};

    return {
      pid: process?.pid,
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
      port: process?.port,
      cronRestart: process?.cronRestart || env.cron_restart || null
    };
  }, [process]);

  if (!process) {
    return null;
  }

  const envVars = process?.details?.pm2_env?.env || {};
  const hasSensitiveEnv = useMemo(
    () => Object.keys(envVars).some((key) => isSensitiveEnvKey(key)),
    [envVars]
  );
  const maxMemory = Math.max(...metricsPoints.map((x) => x.memory || 0), 1);
  const isOnline = process?.status === "online";
  const isStopped = process?.status === "stopped";
  const isCluster = process?.mode === "cluster";

  const runAction = async (action, processName) => {
    setLoadingAction((prev) => ({ ...prev, [action]: true }));
    try {
      await Promise.resolve(onAction(action, processName));
    } finally {
      setLoadingAction((prev) => ({ ...prev, [action]: false }));
    }
  };

  return (
    <Modal title={process.name} onClose={onClose} position="right" closeLabel="Close process details">
        <TabGroup items={tabs} value={tab} onChange={setTab} className="mb-4" />

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
          </div>
        )}

        {tab === "Environment" && (
          <div className="max-h-modal-content overflow-y-auto rounded-md border border-border">
            {hasSensitiveEnv && (
              <div className="flex justify-end border-b border-border p-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setRevealSensitiveEnv((prev) => !prev)}
                >
                  {revealSensitiveEnv ? "Hide Sensitive Values" : "Reveal Sensitive Values"}
                </Button>
              </div>
            )}
            {Object.entries(envVars).map(([key, value]) => (
              <div key={key} className="grid grid-cols-[1fr,1fr,40px] items-center gap-2 border-b border-border p-2 text-xs">
                <span className="flex items-center gap-1 text-text-2">
                  <span>{key}</span>
                  {isSensitiveEnvKey(key) && (
                    <Badge tone="warning" className="gap-1">
                      <ShieldAlert size={11} />
                      Sensitive
                    </Badge>
                  )}
                </span>
                <span className="truncate text-text-1">
                  {isSensitiveEnvKey(key) && !revealSensitiveEnv ? "********" : String(value)}
                </span>
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
            {metricsLoading && <MetricsHistorySkeleton />}
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
              label="Schedule"
              icon={AlarmClock}
              variant="secondary"
              disabled={loadingAction.schedule}
              onClick={() => runAction("schedule", process.name)}
            />
            <QuickAction
              label="Duplicate"
              icon={Copy}
              variant="secondary"
              disabled={loadingAction.duplicate}
              onClick={() => runAction("duplicate", process.name)}
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
              disabled={loadingAction.gitPull}
              onClick={() => runAction("gitPull", process.name)}
            />
            <Button
              type="button"
              className="col-span-2"
              variant="secondary"
              onClick={() => {
                if (typeof onViewDeployHistory === "function") {
                  onViewDeployHistory(process.name);
                }
              }}
            >
              <History size={16} /> Deploy History
            </Button>
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
    </Modal>
  );
}

function MetricsHistorySkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-1 text-xs">
          <div className="flex justify-between">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-2.5 w-full rounded-full" />
          <Skeleton className="h-2.5 w-full rounded-full" />
        </div>
      ))}
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



import { useEffect, useState } from "react";
import {
  AlarmClock,
  Copy,
  Download,
  GitBranch,
  Hammer,
  History,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Square,
  Trash2,
  Undo2
} from "lucide-react";
import toast from "../lib/toast";
import { processes as processApi } from "../api";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import Modal from "./ui/Modal";
import ProgressBar from "./ui/ProgressBar";
import { InsetCard, StatCard } from "./ui/Surface";
import TabGroup from "./ui/TabGroup";
import { Skeleton } from "./ui/Skeleton";
import { Eyebrow, SubsectionTitle, SupportingCopy } from "./ui/Typography";

const tabs = ["Summary", "Environment", "Actions"];
const SENSITIVE_ENV_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|private|credential|auth|pwd)/i;

function isSensitiveEnvKey(key) {
  return SENSITIVE_ENV_KEY_PATTERN.test(String(key || ""));
}

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

function formatMemoryMB(value) {
  return `${(Number(value || 0) / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "0s";
  }

  const totalSec = Math.floor(value / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function healthTone(state) {
  if (state === "healthy") {
    return "success";
  }
  if (state === "unhealthy") {
    return "danger";
  }
  return "warning";
}

export default function ProcessDetailModal({ process, onClose, onAction, onViewDeployHistory, onOpenLogs }) {
  const [tab, setTab] = useState("Summary");
  const [loadingAction, setLoadingAction] = useState({});
  const [metricsPoints, setMetricsPoints] = useState([]);
  const [healthReport, setHealthReport] = useState({ points: [], summary: null });
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [revealSensitiveEnv, setRevealSensitiveEnv] = useState(false);

  useEffect(() => {
    if (!process?.name) {
      return undefined;
    }

    let active = true;
    const loadTelemetry = async () => {
      try {
        setMetricsLoading(true);
        const [metricsResult, healthResult] = await Promise.all([
          processApi.metrics(process.name, 120),
          processApi.health(process.name, 60)
        ]);
        if (active && metricsResult.success && Array.isArray(metricsResult.data)) {
          setMetricsPoints(metricsResult.data);
        }
        if (active && healthResult.success && healthResult.data) {
          setHealthReport({
            points: Array.isArray(healthResult.data.points) ? healthResult.data.points : [],
            summary: healthResult.data.summary || null
          });
        }
      } catch (_error) {
        if (active) {
          setMetricsPoints([]);
          setHealthReport({ points: [], summary: null });
        }
      } finally {
        if (active) {
          setMetricsLoading(false);
        }
      }
    };

    loadTelemetry();
    const timer = setInterval(loadTelemetry, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [process?.name]);

  useEffect(() => {
    setRevealSensitiveEnv(false);
    setTab("Summary");
    setHealthReport({ points: [], summary: null });
  }, [process?.name]);

  if (!process) {
    return null;
  }

  const env = process?.details?.pm2_env || {};
  const envVars = env.env || {};
  const envEntries = Object.entries(envVars);
  const hasSensitiveEnv = envEntries.some(([key]) => isSensitiveEnvKey(key));
  const maxMemory = Math.max(...metricsPoints.map((item) => item.memory || 0), 1);
  const isOnline = process.status === "online";
  const isStopped = process.status === "stopped";
  const isCluster = process.mode === "cluster";
  const healthSummary = healthReport.summary || {};
  const healthPoints = Array.isArray(healthReport.points) ? healthReport.points : [];
  const healthEnabled = Boolean(healthSummary.enabled);

  const summaryItems = [
    { label: "Status", value: process.status || "unknown", tone: isOnline ? "success" : process.status === "errored" ? "danger" : "warning" },
    { label: "PID", value: process.pid ?? "-" },
    { label: "Mode", value: process.mode || "fork" },
    { label: "Port", value: process.port ?? "-" },
    { label: "Restarts", value: process.restarts ?? 0 },
    { label: "Uptime", value: formatDuration(process.uptime) },
    { label: "Cron restart", value: process.cronRestart || env.cron_restart || "-" },
    { label: "Node", value: env.node_version || "-" },
    { label: "PM2", value: env.version || "-" },
    { label: "Working dir", value: env.pm_cwd || "-" },
    { label: "Exec path", value: env.pm_exec_path || "-" },
    { label: "Unstable restarts", value: env.unstable_restarts ?? "-" }
  ];

  const runAction = async (action, processName) => {
    setLoadingAction((prev) => ({ ...prev, [action]: true }));
    try {
      await Promise.resolve(onAction(action, processName));
    } finally {
      setLoadingAction((prev) => ({ ...prev, [action]: false }));
    }
  };

  return (
    <Modal
      title={process.name}
      description="Status, PM2 environment, health probes, and manual actions for this process."
      onClose={onClose}
      position="right"
      closeLabel="Close process details"
    >
      <TabGroup items={tabs} value={tab} onChange={setTab} className="mb-4" />

      {tab === "Summary" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {summaryItems.map((item) => (
              <StatCard
                key={item.label}
                label={item.label}
                value={item.tone ? <Badge tone={item.tone}>{String(item.value)}</Badge> : String(item.value)}
                className="break-all"
              />
            ))}
          </div>

          {healthEnabled && (
            <InsetCard>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <SubsectionTitle className="text-sm">Persistent health checks</SubsectionTitle>
                  <SupportingCopy size="xs">
                    {healthSummary.protocol === "tcp"
                      ? `TCP localhost:${healthSummary.port ?? process.port ?? "-"}`
                      : `HTTP localhost:${healthSummary.port ?? process.port ?? "-"}${healthSummary.path || "/"}`}
                  </SupportingCopy>
                </div>
                <Badge tone={healthTone(healthSummary.currentState)}>
                  {healthSummary.currentState || "pending"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Availability" value={healthSummary.availabilityPct === null || healthSummary.availabilityPct === undefined ? "-" : `${healthSummary.availabilityPct}%`} />
                <StatCard label="Current downtime" value={formatDuration(healthSummary.currentDowntimeMs || 0)} />
                <StatCard label="Last latency" value={healthSummary.lastLatencyMs ? `${healthSummary.lastLatencyMs} ms` : "-"} />
                <StatCard label="Last code" value={healthSummary.lastStatusCode ?? "-"} />
              </div>

              <div className="mt-3 space-y-2">
                {healthSummary.lastReason && (
                  <SupportingCopy size="xs">Last failure reason: {healthSummary.lastReason}</SupportingCopy>
                )}
                {healthPoints.filter((item) => item?.skipped !== true).length === 0 && (
                  <SupportingCopy>No health probe results have been recorded yet.</SupportingCopy>
                )}
                {healthPoints
                  .filter((item) => item?.skipped !== true)
                  .slice(-8)
                  .reverse()
                  .map((item, index) => (
                    <div key={`${item.ts}-${index}`} className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-xs last:border-b-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={item.healthy ? "success" : "danger"}>{item.healthy ? "Pass" : "Fail"}</Badge>
                          <span className="text-text-2">{item.ts ? new Date(item.ts).toLocaleTimeString() : "Recent"}</span>
                        </div>
                        {item.reason && <p className="mt-1 truncate text-text-3">{item.reason}</p>}
                      </div>
                      <div className="text-right text-text-2">
                        <p>{item.latencyMs ? `${item.latencyMs} ms` : "-"}</p>
                        <p>{item.statusCode ?? item.processStatus ?? "-"}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </InsetCard>
          )}

          <InsetCard>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SubsectionTitle className="text-sm">Recent resource history</SubsectionTitle>
              <div className="flex flex-wrap gap-2">
                {typeof onOpenLogs === "function" && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => onOpenLogs(process.name)}>
                    <ScrollText size={14} />
                    Logs
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (typeof onViewDeployHistory === "function") {
                      onViewDeployHistory(process.name);
                    }
                  }}
                >
                  <History size={14} />
                  Deploy history
                </Button>
              </div>
            </div>
            {metricsLoading && <MetricsHistorySkeleton />}
            {!metricsLoading && metricsPoints.length === 0 && (
              <SupportingCopy>No metrics history has been recorded yet.</SupportingCopy>
            )}
            {!metricsLoading && metricsPoints.length > 0 && (
              <div className="space-y-2">
                {metricsPoints.slice(-10).reverse().map((item, index) => (
                  <div key={`${item.ts}-${index}`} className="space-y-1 text-xs">
                    <div className="flex justify-between text-text-2">
                      <span>{item.ts ? new Date(item.ts).toLocaleTimeString() : `Point ${index + 1}`}</span>
                      <span>CPU {item.cpu}% | MEM {formatMemoryMB(item.memory)}</span>
                    </div>
                    <ProgressBar value={item.cpu} tone={item.cpu >= 80 ? "warning" : "success"} />
                    <ProgressBar value={(item.memory / maxMemory) * 100} tone="info" />
                  </div>
                ))}
              </div>
            )}
          </InsetCard>
        </div>
      )}

      {tab === "Environment" && (
        <InsetCard className="max-h-modal-content overflow-y-auto p-0">
          <div className="flex items-center justify-between border-b border-border/80 bg-surface-2/70 p-3">
            <div>
              <SubsectionTitle className="text-sm">Runtime environment</SubsectionTitle>
              <SupportingCopy size="xs">{envEntries.length} variables available</SupportingCopy>
            </div>
            {hasSensitiveEnv && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setRevealSensitiveEnv((prev) => !prev)}
              >
                {revealSensitiveEnv ? "Hide sensitive values" : "Reveal sensitive values"}
              </Button>
            )}
          </div>
          {envEntries.length === 0 ? (
            <SupportingCopy className="p-4">No PM2 environment variables were returned for this process.</SupportingCopy>
          ) : (
            envEntries.map(([key, value]) => (
              <div key={key} className="grid grid-cols-[minmax(0,1fr),minmax(0,1fr),40px] items-center gap-2 border-b border-border/70 p-2 text-xs last:border-b-0">
                <span className="flex min-w-0 items-center gap-1 text-text-2">
                  <span className="truncate">{key}</span>
                  {isSensitiveEnvKey(key) && <Badge tone="warning">Sensitive</Badge>}
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
            ))
          )}
        </InsetCard>
      )}

      {tab === "Actions" && (
        <div className="space-y-4">
          <ActionSection
            title="Runtime"
            description="Common PM2 controls for this process."
            actions={[
              { label: "Start", icon: Play, variant: "success", disabled: isOnline || loadingAction.start, onClick: () => runAction("start", process.name) },
              { label: "Stop", icon: Square, variant: "danger", disabled: isStopped || loadingAction.stop, onClick: () => runAction("stop", process.name) },
              { label: "Restart", icon: RefreshCw, variant: "info", disabled: loadingAction.restart, onClick: () => runAction("restart", process.name) },
              { label: "Reload", icon: RotateCcw, variant: "warning", disabled: !isCluster || !isOnline || loadingAction.reload, onClick: () => runAction("reload", process.name) }
            ]}
          />
          <ActionSection
            title="Code and packages"
            description="Pull code or run package tasks in the process working directory."
            actions={[
              { label: "Git pull", icon: GitBranch, variant: "secondary", disabled: loadingAction.gitPull, onClick: () => runAction("gitPull", process.name) },
              { label: "NPM install", icon: Download, variant: "secondary", disabled: loadingAction.npmInstall, onClick: () => runAction("npmInstall", process.name) },
              { label: "NPM build", icon: Hammer, variant: "secondary", disabled: loadingAction.npmBuild, onClick: () => runAction("npmBuild", process.name) }
            ]}
          />
          <ActionSection
            title="Advanced"
            description="Schedule, duplicate, or roll back when you are changing process behavior."
            actions={[
              { label: "Schedule restart", icon: AlarmClock, variant: "secondary", disabled: loadingAction.schedule, onClick: () => runAction("schedule", process.name) },
              { label: "Duplicate", icon: Copy, variant: "secondary", disabled: loadingAction.duplicate, onClick: () => runAction("duplicate", process.name) },
              { label: "Rollback", icon: Undo2, variant: "warning", disabled: loadingAction.rollback, onClick: () => runAction("rollback", process.name) }
            ]}
          />
          <Button type="button" className="w-full" variant="danger" disabled={loadingAction.delete} onClick={() => runAction("delete", process.name)}>
            <Trash2 size={16} />
            Delete process
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
      <Icon size={16} />
      {label}
    </Button>
  );
}

function ActionSection({ title, description, actions }) {
  return (
    <InsetCard>
      <div className="mb-3">
        <SubsectionTitle className="text-sm">{title}</SubsectionTitle>
        <SupportingCopy size="xs" className="mt-1">{description}</SupportingCopy>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <QuickAction
            key={action.label}
            label={action.label}
            icon={action.icon}
            variant={action.variant}
            disabled={action.disabled}
            onClick={action.onClick}
          />
        ))}
      </div>
    </InsetCard>
  );
}

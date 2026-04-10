import { AlertTriangle, History, ScrollText, ServerCrash, ShieldCheck, ShieldX } from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { PanelHeader } from "../ui/PageLayout";

function buildAttentionItems({ alerts = [], processes = [], monitoringSummary = [] }) {
  const items = [];
  const seen = new Set();

  alerts
    .slice()
    .reverse()
    .slice(0, 4)
    .forEach((alert, index) => {
      const processName = alert.processName || "Unknown process";
      const key = `alert:${processName}:${alert.metric}:${alert.ts || index}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      items.push({
        key,
        processName,
        tone: alert.severity === "danger" ? "danger" : "warning",
        label: `${alert.metric} ${alert.value} / ${alert.threshold}`,
        detail: alert.ts ? new Date(alert.ts).toLocaleTimeString() : "Recent alert"
      });
    });

  processes.forEach((process) => {
    const summary = monitoringSummary[process.name] || {};
    const anomaly = summary.anomaly || {};
    const isAttention = process.status === "errored" || process.status === "stopped" || anomaly.isAnomaly;
    if (!isAttention) {
      return;
    }

    const key = `process:${process.name}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({
      key,
      processName: process.name,
      tone: process.status === "errored" ? "danger" : anomaly.isAnomaly ? "warning" : "info",
      label: process.status === "errored"
        ? "Process errored"
        : process.status === "stopped"
          ? "Process stopped"
          : `Anomaly score ${anomaly.score}`,
      detail: `${process.restarts ?? 0} restart${process.restarts === 1 ? "" : "s"}`
    });
  });

  return items.slice(0, 5);
}

function buildAttentionProcessNames({ alerts = [], processes = [], monitoringSummary = [] }) {
  const names = new Set();

  alerts.forEach((alert) => {
    const processName = String(alert.processName || "").trim();
    if (processName) {
      names.add(processName);
    }
  });

  processes.forEach((process) => {
    const summary = monitoringSummary[process.name] || {};
    const anomaly = summary.anomaly || {};
    if (process.status === "errored" || process.status === "stopped" || anomaly.isAnomaly) {
      names.add(process.name);
    }
  });

  return names;
}

export default function OperationsOverviewPanel({
  stats,
  alerts,
  processes,
  monitoringSummary,
  onOpenLogs,
  onOpenHistory
}) {
  const attentionItems = buildAttentionItems({ alerts, processes, monitoringSummary });
  const attentionProcessNames = buildAttentionProcessNames({ alerts, processes, monitoringSummary });
  const attentionCount = attentionProcessNames.size;
  const healthyCount = processes.filter(
    (process) => process.status === "online" && !attentionProcessNames.has(process.name)
  ).length;

  return (
    <section className="page-panel space-y-4">
      <PanelHeader
        title="Operations Overview"
        description="Start from live state, current exceptions, and the fastest path back to a healthy fleet."
        actions={(
          <>
            <Button type="button" size="sm" variant="secondary" onClick={onOpenHistory}>
              <History size={14} />
              Review history
            </Button>
            <Badge tone={attentionCount > 0 ? "warning" : "success"}>
              {attentionCount > 0 ? `${attentionCount} process${attentionCount === 1 ? " needs" : "es need"} attention` : "Fleet stable"}
            </Badge>
          </>
        )}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="ops-kpi">
          <p className="ops-kpi-label">Fleet</p>
          <p className="ops-kpi-value">{stats?.online ?? 0} / {stats?.total ?? 0}</p>
          <p className="ops-kpi-note">Processes online right now</p>
        </div>
        <div className="ops-kpi">
          <p className="ops-kpi-label">Attention</p>
          <p className="ops-kpi-value text-warning-300">{attentionCount}</p>
          <p className="ops-kpi-note">Errored, stopped, or anomalous processes</p>
        </div>
        <div className="ops-kpi">
          <p className="ops-kpi-label">Recent Alerts</p>
          <p className="ops-kpi-value">{alerts.length}</p>
          <p className="ops-kpi-note">Threshold hits in the current socket session</p>
        </div>
        <div className="ops-kpi">
          <p className="ops-kpi-label">Healthy</p>
          <p className="ops-kpi-value text-success-300">{healthyCount}</p>
          <p className="ops-kpi-note">Online processes without active alert noise</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/80 bg-surface-2/50 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {attentionCount > 0 ? (
              <AlertTriangle size={16} className="text-warning-300" />
            ) : (
              <ShieldCheck size={16} className="text-success-300" />
            )}
            <p className="text-sm font-medium text-text-1">
              {attentionCount > 0 ? "Attention queue" : "No active incidents"}
            </p>
          </div>
          {attentionCount > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={onOpenHistory}>
              Full timeline
            </Button>
          )}
        </div>

        {attentionItems.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-success-500/30 bg-success-500/10 px-3 py-2 text-sm text-success-300">
            <ShieldX size={16} className="rotate-180" />
            No current errors, stops, or anomaly spikes.
          </div>
        ) : (
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <div key={item.key} className="flex flex-col gap-3 rounded-lg border border-border/80 bg-surface px-3 py-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <ServerCrash size={16} className={item.tone === "danger" ? "text-danger-300" : item.tone === "warning" ? "text-warning-300" : "text-info-300"} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-text-1">{item.processName}</p>
                      <Badge tone={item.tone}>{item.label}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-text-3">{item.detail}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => onOpenLogs(item.processName)}>
                    <ScrollText size={14} />
                    Logs
                  </Button>
                  <Button type="button" size="sm" variant="outlineInfo" onClick={onOpenHistory}>
                    <History size={14} />
                    History
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

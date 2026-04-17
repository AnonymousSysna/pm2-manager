import { AlertTriangle, History, ScrollText, ServerCrash, ShieldCheck, ShieldX } from "lucide-react";
import Badge from "../ui/Badge";
import Banner from "../ui/Banner";
import Button from "../ui/Button";
import { PanelHeader } from "../ui/PageLayout";
import { InsetCard, StatCard } from "../ui/Surface";
import { SubsectionTitle, SupportingCopy } from "../ui/Typography";

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
    const health = summary.health || {};
    const isAttention =
      process.status === "errored" ||
      process.status === "stopped" ||
      anomaly.isAnomaly ||
      (health.enabled && health.currentState === "unhealthy");
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
      tone:
        process.status === "errored" || (health.enabled && health.currentState === "unhealthy")
          ? "danger"
          : anomaly.isAnomaly
            ? "warning"
            : "info",
      label: process.status === "errored"
        ? "Process errored"
        : health.enabled && health.currentState === "unhealthy"
          ? "Health check failing"
        : process.status === "stopped"
          ? "Process stopped"
          : `Anomaly score ${anomaly.score}`,
      detail:
        health.enabled && health.currentState === "unhealthy"
          ? health.lastReason || "Probe failures exceeded threshold"
          : `${process.restarts ?? 0} restart${process.restarts === 1 ? "" : "s"}`
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
    const health = summary.health || {};
    if (
      process.status === "errored" ||
      process.status === "stopped" ||
      anomaly.isAnomaly ||
      (health.enabled && health.currentState === "unhealthy")
    ) {
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
        <StatCard label="Fleet" value={`${stats?.online ?? 0} / ${stats?.total ?? 0}`} note="Processes online right now" tone="elevated" />
        <StatCard
          label="Attention"
          value={attentionCount}
          valueClassName="text-warning-300"
          note="Errored, stopped, unhealthy, or anomalous processes"
          tone="elevated"
        />
        <StatCard label="Recent Alerts" value={alerts.length} note="Threshold hits in the current socket session" tone="elevated" />
        <StatCard
          label="Healthy"
          value={healthyCount}
          valueClassName="text-success-300"
          note="Online processes without active alert noise"
          tone="elevated"
        />
      </div>

      <InsetCard className="rounded-xl bg-surface-2/50">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {attentionCount > 0 ? (
              <AlertTriangle size={16} className="text-warning-300" />
            ) : (
              <ShieldCheck size={16} className="text-success-300" />
            )}
            <SubsectionTitle className="text-sm">
              {attentionCount > 0 ? "Attention queue" : "No active incidents"}
            </SubsectionTitle>
          </div>
          {attentionCount > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={onOpenHistory}>
              Full timeline
            </Button>
          )}
        </div>

        {attentionItems.length === 0 ? (
          <Banner tone="success" icon={<ShieldX size={16} className="rotate-180" />}>
            No current errors, unhealthy checks, stops, or anomaly spikes.
          </Banner>
        ) : (
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <InsetCard key={item.key} tone="surface" className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <ServerCrash size={16} className={item.tone === "danger" ? "text-danger-300" : item.tone === "warning" ? "text-warning-300" : "text-info-300"} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SubsectionTitle className="text-sm">{item.processName}</SubsectionTitle>
                      <Badge tone={item.tone}>{item.label}</Badge>
                    </div>
                    <SupportingCopy size="xs" className="mt-1">{item.detail}</SupportingCopy>
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
              </InsetCard>
            ))}
          </div>
        )}
      </InsetCard>
    </section>
  );
}

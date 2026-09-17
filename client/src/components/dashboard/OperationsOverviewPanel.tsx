import { AlertTriangle, History, ScrollText, ServerCrash, ShieldCheck, ShieldX } from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { PanelHeader } from "../ui/PageLayout";
import { InsetCard } from "../ui/Surface";
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
  const failingHealthNames = processes
    .filter((process) => (monitoringSummary[process.name]?.health?.enabled && monitoringSummary[process.name]?.health?.currentState === "unhealthy"))
    .map((process) => process.name);
  const stoppedOrErroredNames = processes
    .filter((process) => process.status === "stopped" || process.status === "errored")
    .map((process) => process.name);
  const alertProcessNames = Array.from(
    new Set(alerts.map((alert) => String(alert.processName || "").trim()).filter(Boolean))
  );
  const firstAttentionProcess = attentionItems[0]?.processName || "";

  return (
    <section className="page-panel dashboard-triage-panel">
      <PanelHeader
        title="Triage"
        actions={(
          <>
            <Button type="button" size="sm" variant="secondary" onClick={onOpenHistory}>
              <History size={14} />
              History
            </Button>
            <Badge tone={attentionCount > 0 ? "warning" : "success"}>
              {attentionCount > 0 ? `${attentionCount} process${attentionCount === 1 ? " needs" : "es need"} attention` : "Fleet stable"}
            </Badge>
          </>
        )}
      />

      <div className="compact-stat-grid">
        <ActionBlock
          label="Attention"
          title={attentionCount > 0 ? `${attentionCount} service${attentionCount === 1 ? "" : "s"}` : "Clear"}
          tone={attentionCount > 0 ? "warning" : "success"}
          detail={attentionCount > 0 ? summarizeNames(Array.from(attentionProcessNames)) : `${stats?.online ?? 0} of ${stats?.total ?? 0} processes are online.`}
          actionLabel={firstAttentionProcess ? "Open logs" : null}
          onAction={firstAttentionProcess ? () => onOpenLogs(firstAttentionProcess) : null}
        />
        <ActionBlock
          label="Health"
          title={failingHealthNames.length > 0 ? `${failingHealthNames.length} failing` : "Clear"}
          tone={failingHealthNames.length > 0 ? "danger" : "success"}
          detail={failingHealthNames.length > 0 ? summarizeNames(failingHealthNames) : "Clear."}
          actionLabel={failingHealthNames[0] ? "Open logs" : null}
          onAction={failingHealthNames[0] ? () => onOpenLogs(failingHealthNames[0]) : null}
        />
        <ActionBlock
          label="Runtime"
          title={stoppedOrErroredNames.length > 0 ? `${stoppedOrErroredNames.length} stopped` : "Running"}
          tone={stoppedOrErroredNames.length > 0 ? "warning" : "success"}
          detail={stoppedOrErroredNames.length > 0 ? summarizeNames(stoppedOrErroredNames) : "Clear."}
          actionLabel={stoppedOrErroredNames[0] ? "Review" : "History"}
          onAction={() => onOpenHistory()}
        />
        <ActionBlock
          label="Alerts"
          title={`${alerts.length} recent`}
          tone={alerts.length > 0 ? "info" : "neutral"}
          detail={alerts.length > 0 ? summarizeNames(alertProcessNames) : "Clear."}
          actionLabel="History"
          onAction={() => onOpenHistory()}
        />
      </div>

      <InsetCard className="flow-strip">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {attentionCount > 0 ? (
              <AlertTriangle size={16} className="text-warning-300" />
            ) : (
              <ShieldCheck size={16} className="text-success-300" />
            )}
            <SubsectionTitle className="text-sm">
              {attentionCount > 0 ? "Attention queue" : "Quiet state"}
            </SubsectionTitle>
          </div>
          {attentionCount > 0 && (
            <Button type="button" size="sm" variant="secondary" onClick={onOpenHistory}>
              Full timeline
            </Button>
          )}
        </div>

        {attentionItems.length === 0 ? (
          <div className="quiet-empty-state">
            <ShieldX size={16} className="mx-auto mb-2 rotate-180 text-success-300" />
            All clear.
          </div>
        ) : (
          <div className="space-y-2">
            {attentionItems.map((item) => (
              <InsetCard key={item.key} tone="surface" padding="sm" className="flex flex-col gap-2 lg:flex-row lg:items-center">
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

function summarizeNames(names = []) {
  if (names.length === 0) {
    return "No processes.";
  }
  if (names.length <= 3) {
    return names.join(", ");
  }
  return `${names.slice(0, 3).join(", ")}, +${names.length - 3} more`;
}

function ActionBlock({ label, title, detail, tone, actionLabel, onAction }) {
  return (
    <InsetCard className="triage-card" padding="sm">
      <div className="flex h-full flex-col gap-2">
        <div className="triage-card-topline">
          <SupportingCopy size="xs" className="uppercase tracking-[0.16em]">{label}</SupportingCopy>
          <Badge tone={tone}>{title}</Badge>
        </div>
        <SupportingCopy size="xs" className="min-h-8">{detail}</SupportingCopy>
        {actionLabel && onAction ? (
          <div className="mt-auto">
            <Button type="button" size="sm" variant="secondary" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </InsetCard>
  );
}

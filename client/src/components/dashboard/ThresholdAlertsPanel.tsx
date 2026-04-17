import { AlertTriangle } from "lucide-react";
import Button from "../ui/Button";
import { PanelHeader } from "../ui/PageLayout";
import { InsetCard } from "../ui/Surface";
import { SubsectionTitle, SupportingCopy } from "../ui/Typography";

export default function ThresholdAlertsPanel({ alerts = [], onOpenLogs }) {
  return (
    <section className="page-panel space-y-3">
      <PanelHeader
        title="Alert Feed"
        description="Recent threshold and health incidents worth investigating before they turn into noisy restarts."
      />
      {alerts.length === 0 && <p className="text-sm text-text-3">No active alerts in the current session.</p>}
      <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
        {alerts
          .slice()
          .reverse()
          .slice(0, 20)
          .map((item, index) => (
            <InsetCard key={`${item.ts}-${index}`} className="bg-surface-2/60">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className={item.severity === "danger" ? "text-danger-300" : "text-warning-300"} />
                <div className="min-w-0 flex-1">
                  <SubsectionTitle className="text-sm">{item.processName}</SubsectionTitle>
                  <SupportingCopy tone="default" className="mt-1">
                    {item.message || (item.threshold !== undefined
                      ? `${item.metric} at ${item.value} against threshold ${item.threshold}`
                      : `${item.metric || "health"} alert`)}
                  </SupportingCopy>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-text-3">{new Date(item.ts).toLocaleTimeString()}</span>
                    {typeof onOpenLogs === "function" && item.processName && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => onOpenLogs(item.processName)}>
                        Open logs
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </InsetCard>
          ))}
      </div>
    </section>
  );
}

// @ts-nocheck
import { AlertTriangle } from "lucide-react";
import { PanelHeader } from "../ui/PageLayout";

export default function ThresholdAlertsPanel({ alerts = [] }) {
  return (
    <section className="rounded-[1.5rem] border border-border bg-surface p-4">
      <PanelHeader title="Alert Queue" description="Most recent threshold crossings and anomaly signals." className="mb-3" />
      {alerts.length === 0 && <p className="text-sm text-text-3">No alerts yet.</p>}
      <div className="max-h-52 space-y-2 overflow-y-auto text-sm">
        {alerts
          .slice()
          .reverse()
          .slice(0, 20)
          .map((item, index) => (
            <div key={`${item.ts}-${index}`} className="rounded-[1.1rem] border border-border bg-surface-2/70 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2 py-1 text-[0.65rem] uppercase tracking-[0.18em] ${
                  item.severity === "danger"
                    ? "bg-danger-500/15 text-danger-300"
                    : "bg-warning-500/15 text-warning-300"
                }`}>
                  {item.severity || "warning"}
                </span>
                <AlertTriangle size={14} className={item.severity === "danger" ? "text-danger-300" : "text-warning-300"} />
                <span className="ml-auto text-xs text-text-3">{new Date(item.ts).toLocaleTimeString()}</span>
              </div>
              <p className="mt-2 text-text-2">
                {item.processName}: {item.metric}={item.value} (threshold {item.threshold})
              </p>
            </div>
          ))}
      </div>
    </section>
  );
}

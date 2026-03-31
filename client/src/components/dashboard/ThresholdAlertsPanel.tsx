// @ts-nocheck
import { AlertTriangle } from "lucide-react";
import { PanelHeader } from "../ui/PageLayout";

export default function ThresholdAlertsPanel({ alerts = [] }) {
  return (
    <section className="page-panel">
      <PanelHeader title="Threshold Alerts" className="mb-2" />
      {alerts.length === 0 && <p className="text-sm text-text-3">No alerts yet.</p>}
      <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
        {alerts
          .slice()
          .reverse()
          .slice(0, 20)
          .map((item, index) => (
            <div key={`${item.ts}-${index}`} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <AlertTriangle size={14} className={item.severity === "danger" ? "text-danger-300" : "text-warning-300"} />
              <span className="text-text-2">
                {item.processName}: {item.metric}={item.value} (threshold {item.threshold})
              </span>
              <span className="ml-auto text-xs text-text-3">{new Date(item.ts).toLocaleTimeString()}</span>
            </div>
          ))}
      </div>
    </section>
  );
}

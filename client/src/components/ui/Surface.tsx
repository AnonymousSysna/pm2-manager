import { cn } from "../../lib/cn";
import { Eyebrow, MetricValue, SupportingCopy } from "./Typography";

const panelPaddingMap = {
  sm: "p-3",
  md: "p-4",
  lg: "p-5"
};

const insetPaddingMap = {
  sm: "p-2",
  md: "p-3",
  lg: "p-4"
};

const insetToneMap = {
  muted: "bg-surface-2/70",
  surface: "bg-surface",
  elevated: "bg-surface-2/80"
};

export function Panel({ as: Comp = "section", padding = "md", className, ...props }) {
  return <Comp className={cn("page-panel", panelPaddingMap[padding] || panelPaddingMap.md, className)} {...props} />;
}

export function InsetCard({ as: Comp = "div", padding = "md", tone = "muted", className, ...props }) {
  return (
    <Comp
      className={cn("inset-card", insetPaddingMap[padding] || insetPaddingMap.md, insetToneMap[tone] || insetToneMap.muted, className)}
      {...props}
    />
  );
}

export function StatCard({ label, value, note, valueClassName, className, tone = "muted" }) {
  return (
    <InsetCard tone={tone} className={className}>
      <Eyebrow>{label}</Eyebrow>
      <MetricValue className="mt-2">
        <span className={valueClassName}>{value}</span>
      </MetricValue>
      {note ? <SupportingCopy size="xs" className="mt-1">{note}</SupportingCopy> : null}
    </InsetCard>
  );
}

// @ts-nocheck
import { cn } from "../../lib/cn";

const tones = {
  info: "border-info-500/40 bg-info-500/10 text-info-300",
  success: "border-success-500/40 bg-success-500/10 text-success-300",
  warning: "border-warning-500/40 bg-warning-500/10 text-warning-300",
  danger: "border-danger-500/40 bg-danger-500/10 text-danger-300",
  neutral: "border-border bg-surface-2 text-text-2"
};

export default function Banner({ tone = "neutral", icon, className, children }) {
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone] || tones.neutral, className)}>
      <div className="flex items-start gap-2">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

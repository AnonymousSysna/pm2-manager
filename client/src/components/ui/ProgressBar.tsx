import { cn } from "../../lib/cn";

const tones = {
  success: "bg-success-500",
  info: "bg-info-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  neutral: "bg-text-3"
};

export default function ProgressBar({ value = 0, tone = "success", className }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div className={cn("h-1.5 rounded bg-surface-3", className)}>
      <div className={cn("h-1.5 rounded", tones[tone] || tones.neutral)} style={{ width: `${width}%` }} />
    </div>
  );
}


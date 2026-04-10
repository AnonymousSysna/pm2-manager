import { cn } from "../../lib/cn";

const tones = {
  success: "bg-success-500/20 text-success-300",
  danger: "bg-danger-500/20 text-danger-300",
  warning: "bg-warning-500/20 text-warning-300",
  info: "bg-info-500/20 text-info-300",
  neutral: "bg-surface-3 text-text-2"
};

export default function Badge({ tone = "neutral", className, children }) {
  return <span className={cn("inline-flex rounded-full px-2 py-1 text-xs font-medium", tones[tone] || tones.neutral, className)}>{children}</span>;
}


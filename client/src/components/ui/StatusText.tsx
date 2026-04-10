import { cn } from "../../lib/cn";

const toneMap = {
  success: "text-success-300",
  danger: "text-danger-300",
  warning: "text-warning-300",
  info: "text-info-300",
  neutral: "text-text-2"
};

export default function StatusText({ as: Comp = "span", tone = "neutral", className, ...props }) {
  return <Comp className={cn("font-medium", toneMap[tone] || toneMap.neutral, className)} {...props} />;
}

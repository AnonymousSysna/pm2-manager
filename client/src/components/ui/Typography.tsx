import { cn } from "../../lib/cn";

export function Eyebrow({ as: Comp = "p", className, ...props }) {
  return <Comp className={cn("meta-label", className)} {...props} />;
}

export function SubsectionTitle({ as: Comp = "h3", className, ...props }) {
  return <Comp className={cn("subsection-title", className)} {...props} />;
}

export function MetricValue({ as: Comp = "p", className, ...props }) {
  return <Comp className={cn("metric-value", className)} {...props} />;
}

export function SupportingCopy({ as: Comp = "p", tone = "muted", size = "sm", className, ...props }) {
  return (
    <Comp
      className={cn(
        size === "xs" ? "text-xs" : "text-sm",
        tone === "default" ? "text-text-2" : "text-text-3",
        className
      )}
      {...props}
    />
  );
}

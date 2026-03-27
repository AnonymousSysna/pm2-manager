import { cn } from "../../lib/cn";

const variants = {
  primary: "bg-brand-600 text-white hover:bg-brand-500 focus-visible:ring-brand-400",
  secondary: "border border-border bg-surface-2 text-text-1 hover:bg-surface-3 focus-visible:ring-info-300",
  success: "bg-success-600 text-white hover:bg-success-500 focus-visible:ring-success-300",
  danger: "bg-danger-600 text-white hover:bg-danger-500 focus-visible:ring-danger-300",
  warning: "bg-warning-600 text-white hover:bg-warning-500 focus-visible:ring-warning-300",
  info: "bg-info-600 text-white hover:bg-info-500 focus-visible:ring-info-300",
  outline: "border border-border bg-transparent text-text-2 hover:bg-surface-2 focus-visible:ring-info-300",
  outlineSuccess: "border border-success-400/60 bg-transparent text-success-300 hover:bg-success-500/10 focus-visible:ring-success-300",
  outlineDanger: "border border-danger-400/60 bg-transparent text-danger-300 hover:bg-danger-500/10 focus-visible:ring-danger-300",
  outlineWarning: "border border-warning-400/60 bg-transparent text-warning-300 hover:bg-warning-500/10 focus-visible:ring-warning-300",
  outlineInfo: "border border-info-400/60 bg-transparent text-info-300 hover:bg-info-500/10 focus-visible:ring-info-300",
  ghost: "text-text-2 hover:bg-surface-2 focus-visible:ring-info-300"
};

const sizes = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm",
  "sm-icon": "h-7 w-7 rounded p-0",
  icon: "h-8 w-8 p-0"
};

export default function Button({
  as: Comp = "button",
  type = "button",
  variant = "primary",
  size = "md",
  className,
  ...props
}) {
  return (
    <Comp
      type={Comp === "button" ? type : undefined}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant] || variants.primary,
        sizes[size] || sizes.md,
        className
      )}
      {...props}
    />
  );
}

import { cn } from "../../lib/cn";

export default function Select({ className = "", ...props }) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-xl border border-border/80 bg-surface-2/70 px-3 py-2 text-sm text-text-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}


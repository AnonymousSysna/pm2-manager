import { cn } from "../../lib/cn";

export default function Textarea({ className = "", ...props }) {
  return (
    <textarea
      className={cn(
        "w-full rounded-xl border border-border/80 bg-surface-2/70 px-3 py-2 text-sm text-text-1",
        "placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}


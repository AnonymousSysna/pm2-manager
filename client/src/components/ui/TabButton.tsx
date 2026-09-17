import { cn } from "../../lib/cn";

export default function TabButton({ active = false, className = "", type = "button", ...props }) {
  return (
    <button
      type={type}
      className={cn(
        "min-h-9 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        active ? "bg-brand-600 text-white shadow-sm shadow-brand-600/20" : "border border-border/75 bg-surface/30 text-text-2 hover:bg-surface-2 hover:text-text-1",
        className
      )}
      {...props}
    />
  );
}

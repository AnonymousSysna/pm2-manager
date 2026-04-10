import { cn } from "../../lib/cn";

export default function TabButton({ active = false, className, type = "button", ...props }) {
  return (
    <button
      type={type}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        active ? "bg-brand-600 text-white" : "border border-border bg-transparent text-text-2 hover:bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

import { cn } from "../../lib/cn";

export default function NavItem({ as: Comp = "button", active = false, className, type = "button", ...props }) {
  return (
    <Comp
      type={Comp === "button" ? type : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        active ? "bg-brand-500/20 text-brand-400" : "text-text-2 hover:bg-surface-2",
        className
      )}
      {...props}
    />
  );
}

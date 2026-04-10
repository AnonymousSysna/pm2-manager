import { cn } from "../../lib/cn";

export default function TabGroup({ items = [], value, onChange, className }) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto", className)} role="tablist" aria-orientation="horizontal">
      {items.map((item) => {
        const active = item === value;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(item)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              active ? "bg-brand-600 text-white" : "border border-border bg-transparent text-text-2 hover:bg-surface-2"
            )}
          >
            {item}
          </button>
        );
      })}
    </div>
  );
}


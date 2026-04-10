import { cn } from "../../lib/cn";
import TabButton from "./TabButton";

export default function TabGroup({ items = [], value, onChange, className }) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto", className)} role="tablist" aria-orientation="horizontal">
      {items.map((item) => {
        const active = item === value;
        return (
          <TabButton
            key={item}
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(item)}
            active={active}
          >
            {item}
          </TabButton>
        );
      })}
    </div>
  );
}


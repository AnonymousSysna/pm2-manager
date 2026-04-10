import { cn } from "../../lib/cn";

export default function RangeInput({ className, ...props }) {
  return (
    <input
      type="range"
      className={cn(
        "mt-2 w-full accent-brand-500",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

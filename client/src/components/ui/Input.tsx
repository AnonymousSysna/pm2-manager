import { forwardRef } from "react";
import { cn } from "../../lib/cn";

const Input = forwardRef(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "min-h-11 w-full rounded-xl border border-border/80 bg-surface-2/70 px-3 py-2 text-sm text-text-1",
        "placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});

export default Input;


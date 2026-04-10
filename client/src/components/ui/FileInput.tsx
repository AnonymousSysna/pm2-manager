import { forwardRef } from "react";
import { cn } from "../../lib/cn";

const FileInput = forwardRef(function FileInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="file"
      className={cn(
        "w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-1",
        "file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-text-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});

export default FileInput;

import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Groups a label with its control.
 *
 * Audit finding: `description` was destructured as `_description` and discarded,
 * so `htmlFor` and `description` were both inferred as required by callers,
 * producing 47 "missing property" errors across the pages, and a `description`
 * passed by a caller was silently ignored. No caller passes `description`, so it
 * is gone rather than declared-but-ignored.
 */
type FieldProps = {
  label?: ReactNode;
  /** Set when the control cannot be nested inside the label element. */
  htmlFor?: string;
  required?: boolean;
  className?: string;
  children?: ReactNode;
};

export default function Field({ label, htmlFor, required = false, className = "", children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && !htmlFor ? (
        <label className="block space-y-1.5 text-sm font-medium text-text-2">
          <span>
            {label}
            {required ? " *" : ""}
          </span>
          {children}
        </label>
      ) : (
        <>
          {label ? (
            <label htmlFor={htmlFor} className="block text-sm font-medium text-text-2">
              {label}
              {required ? " *" : ""}
            </label>
          ) : null}
          {children}
        </>
      )}
    </div>
  );
}

import { cn } from "../../lib/cn";

export default function Field({
  label,
  htmlFor,
  required = false,
  description: _description,
  className,
  children
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {label && !htmlFor ? (
        <label className="block space-y-1 text-sm text-text-2">
          <span>
            {label}
            {required ? " *" : ""}
          </span>
          {children}
        </label>
      ) : (
        <>
          {label ? (
            <label htmlFor={htmlFor} className="block text-sm text-text-2">
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

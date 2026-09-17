import { cn } from "../../lib/cn";

export default function Field({
  label,
  htmlFor,
  required = false,
  description: _description,
  className = "",
  children
}) {
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

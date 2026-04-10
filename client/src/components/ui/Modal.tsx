// @ts-nocheck
import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import Button from "./Button";

const sizeMap = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-3xl"
};

export default function Modal({
  title,
  description,
  actions,
  children,
  onClose,
  closeLabel = "Close dialog",
  size = "md",
  position = "center",
  className,
  bodyClassName,
  showCloseButton = true,
  disableClose = false,
  disableOverlayClose = false
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const onEsc = (event) => {
      if (event.key === "Escape" && !disableClose) {
        onClose?.();
      }
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [disableClose, onClose]);

  if (position === "right") {
    return (
      <div className="fixed inset-0 z-50">
        <button
          type="button"
          className="surface-overlay absolute inset-0"
          aria-label={closeLabel}
          onClick={() => {
            if (!disableClose && !disableOverlayClose) {
              onClose?.();
            }
          }}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={cn("absolute right-0 top-0 h-full w-full max-w-xl border-l border-border bg-surface p-6 text-text-1 shadow-xl", className)}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="panel-heading">{title}</h2>
              {description ? <p id={descriptionId} className="panel-muted mt-1">{description}</p> : null}
            </div>
            {showCloseButton ? (
              <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={disableClose} aria-label={closeLabel}>
                <X size={20} />
              </Button>
            ) : null}
          </div>
          <div className={bodyClassName}>{children}</div>
          {actions ? <div className="mt-4 flex flex-wrap justify-end gap-2">{actions}</div> : null}
        </aside>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="surface-overlay absolute inset-0"
        aria-label={closeLabel}
        onClick={() => {
          if (!disableClose && !disableOverlayClose) {
            onClose?.();
          }
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn("relative z-10 w-full rounded-xl border border-border bg-surface p-4 shadow-xl", sizeMap[size] || sizeMap.md, className)}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="panel-heading">{title}</h2>
            {description ? <p id={descriptionId} className="panel-muted mt-1">{description}</p> : null}
          </div>
          {showCloseButton ? (
            <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={disableClose} aria-label={closeLabel}>
              <X size={18} />
            </Button>
          ) : null}
        </div>
        <div className={bodyClassName}>{children}</div>
        {actions ? <div className="mt-4 flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onConfirm,
  onClose,
  confirmDisabled = false,
  closeLabel
}) {
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      closeLabel={closeLabel}
      actions={(
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={confirmDisabled}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
        </>
      )}
    />
  );
}

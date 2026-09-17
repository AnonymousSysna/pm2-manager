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

const dialogPanelClasses = "border border-border/80 bg-surface text-text-1 shadow-2xl shadow-black/25";
const dialogHeaderClasses = "flex shrink-0 items-start justify-between gap-3 border-b border-border/70 pb-3";
const dialogBodyClasses = "min-h-0 flex-1 overflow-y-auto py-4";
const dialogFooterClasses = "flex shrink-0 flex-wrap justify-end gap-2 border-t border-border/70 pt-3";

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
      <div className="fixed inset-0 z-[1000]">
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
          className={cn("absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l p-4", dialogPanelClasses, className)}
        >
          <div className={dialogHeaderClasses}>
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
          <div className={cn(dialogBodyClasses, bodyClassName)}>{children}</div>
          {actions ? <div className={dialogFooterClasses}>{actions}</div> : null}
        </aside>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
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
        className={cn("relative z-10 flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-2xl p-4", dialogPanelClasses, sizeMap[size] || sizeMap.md, className)}
      >
        <div className={dialogHeaderClasses}>
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
        <div className={cn(dialogBodyClasses, bodyClassName)}>{children}</div>
        {actions ? <div className={dialogFooterClasses}>{actions}</div> : null}
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
  const confirmDescriptionId = useId();

  return (
    <Modal
      title={title}
      onClose={onClose}
      closeLabel={closeLabel}
      bodyClassName="confirm-dialog-body"
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
    >
      {description ? (
        <div id={confirmDescriptionId} className="confirm-dialog-message panel-muted">
          {description}
        </div>
      ) : null}
    </Modal>
  );
}

import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import Button, { type ButtonVariant } from "./Button";
import { SupportingCopy } from "./Typography";

const sizeMap = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-3xl"
};

const drawerSizeMap = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl"
};

const dialogPanelClasses = "border border-border/80 bg-surface text-text-1 shadow-2xl shadow-black/25";
const dialogHeaderClasses = "flex shrink-0 items-start justify-between gap-3 border-b border-border/70 pb-3";
const dialogBodyClasses = "min-h-0 flex-1 overflow-y-auto py-4";
const dialogFooterClasses = "flex shrink-0 flex-wrap justify-end gap-2 border-t border-border/70 pt-3";

/**
 * Note the description below is rendered and wired to `aria-describedby`.
 * Audit finding: it used to be destructured as `_description` and dropped, so a
 * modal could be passed an explanation that never appeared and a dialog could
 * not be described to a screen reader.
 */
export type ModalProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  onClose?: () => void;
  closeLabel?: string;
  size?: keyof typeof sizeMap;
  /** "right" renders a side drawer instead of a centered dialog. */
  position?: "center" | "right";
  className?: string;
  bodyClassName?: string;
  showCloseButton?: boolean;
  disableClose?: boolean;
  disableOverlayClose?: boolean;
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
  className = "",
  bodyClassName,
  showCloseButton = true,
  disableClose = false,
  disableOverlayClose = false
}: ModalProps) {
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

  const titleBlock = (
    <div className="min-w-0 flex-1">
      <h2 id={titleId} className="panel-heading">{title}</h2>
      {description ? (
        <SupportingCopy size="xs" className="mt-1" id={descriptionId}>
          {description}
        </SupportingCopy>
      ) : null}
    </div>
  );

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
          className={cn(
            "absolute right-0 top-0 flex h-full w-full flex-col border-l p-3",
            drawerSizeMap[size] || drawerSizeMap.lg,
            dialogPanelClasses,
            className
          )}
        >
          <div className={dialogHeaderClasses}>
            {titleBlock}
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
          {titleBlock}
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

export type ConfirmDialogProps = {
  title?: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  onConfirm?: () => void;
  onClose?: () => void;
  confirmDisabled?: boolean;
  closeLabel?: string;
};

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
}: ConfirmDialogProps) {
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

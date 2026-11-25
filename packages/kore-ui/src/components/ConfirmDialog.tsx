"use client";

import { AlertDialog } from "radix-ui";
import { useState, type ReactElement, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { CaptureOpener, useReturnFocus } from "../lib/focus";
import { Button } from "./Button";
import { overlayClass } from "./Dialog";

export type ConfirmDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional opener (rendered `asChild`), for uncontrolled use. */
  trigger?: ReactElement;
  /** A question naming the thing: "Delete “Q3 budget.csv”?" */
  title: ReactNode;
  /** The consequence, plainly: "It moves to Trash for 30 days." */
  description?: ReactNode;
  /** The verb from the title: "Delete", "Sign out", "Reset password". Never "OK" or "Yes". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Shown on the confirm button while `onConfirm` runs. Default "Working…". */
  pendingLabel?: string;
  /** Destructive: red confirm button. */
  danger?: boolean;
  /** E.g. while the data the question is about is still loading. */
  confirmDisabled?: boolean;
  /** Runs on confirm. While its promise is pending both buttons are disabled; the dialog closes when it resolves. Throw to keep it open. */
  onConfirm: () => Promise<void> | void;
  /** Extra content between the description and the buttons (e.g. a checkbox). */
  children?: ReactNode;
};

/**
 * A yes/no question before something consequential. Cancel has initial focus, so an accidental
 * Enter never confirms; Escape cancels; focus returns to the opener.
 */
export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  pendingLabel = "Working…",
  danger = false,
  confirmDisabled = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [openState, setOpenState] = useState(false);
  const [pending, setPending] = useState(false);
  const open = openProp ?? openState;
  const focus = useReturnFocus();
  const setOpen = (next: boolean) => {
    if (pending && !next) return;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  async function confirm() {
    if (pending || confirmDisabled) return;
    setPending(true);
    try {
      await onConfirm();
      setPending(false);
      if (openProp === undefined) setOpenState(false);
      onOpenChange?.(false);
    } catch {
      // The caller shows the error (e.g. a toast or inline text); the dialog stays open.
      setPending(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger> : null}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClass} />
        <AlertDialog.Content
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
            "rounded-overlay border border-border-strong bg-raised p-5 text-text shadow-dialog outline-none",
            "data-[state=open]:animate-kore-dialog-in data-[state=closed]:animate-kore-dialog-out",
          )}
        >
          <CaptureOpener onMount={focus.capture} />
          <AlertDialog.Title className="text-title font-semibold tracking-[-0.01em]">{title}</AlertDialog.Title>
          {description ? (
            <AlertDialog.Description className="mt-2 text-muted">{description}</AlertDialog.Description>
          ) : (
            <AlertDialog.Description className="sr-only">{title}</AlertDialog.Description>
          )}
          {children ? <div className="mt-4">{children}</div> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant={danger ? "danger" : "primary"}
              disabled={confirmDisabled}
              loading={pending}
              onClick={() => void confirm()}
            >
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

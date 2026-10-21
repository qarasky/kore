"use client";

import { useId, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { Modal } from "./Modal";

/**
 * Accessible yes/no confirmation (focus trapped in the dialog, Escape
 * cancels, focus returns to the opener). Cancel has initial focus, so an
 * accidental Enter never confirms something destructive. While `onConfirm`
 * runs both buttons are disabled.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  returnFocus,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** E.g. while the data the question is about is still loading. */
  confirmDisabled?: boolean;
  /** Where focus goes when the dialog closes (default: the opener). */
  returnFocus?: () => HTMLElement | null | undefined;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending || confirmDisabled) return;
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      role="alertdialog"
      labelledBy={titleId}
      describedBy={messageId}
      onClose={() => !pending && onCancel()}
      initialFocus={cancelRef}
      returnFocus={returnFocus}
      className="w-[min(420px,calc(100vw-32px))]"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <p id={messageId} className="mt-2 text-muted">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-ui border border-border-strong px-3.5 py-1.5 font-medium hover:bg-white/5 disabled:opacity-60"
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || confirmDisabled}
            aria-busy={pending || undefined}
            className={
              "rounded-ui px-3.5 py-1.5 font-medium text-white disabled:cursor-wait disabled:opacity-60 " +
              (danger ? "bg-[#c94b4f] hover:bg-[#d65b5f]" : "bg-accent hover:bg-accent-hover")
            }
          >
            {pending ? t("list.working") : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

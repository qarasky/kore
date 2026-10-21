"use client";

import { useEffect, useEffectEvent, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

/**
 * A modal on the native `<dialog>` (`showModal()`): the rest of the page is
 * inert, so Tab stays inside (focus trap) and screen readers only see the
 * dialog. Escape calls `onClose`; when the modal unmounts, focus goes back to
 * the element that had it when it opened (or `returnFocus()`, if given).
 */
export function Modal({
  labelledBy,
  describedBy,
  label,
  role,
  onClose,
  initialFocus,
  returnFocus,
  onKeyDown,
  className = "",
  children,
}: {
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  /** `alertdialog` for confirmations. */
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  /** Focused after opening (else the browser's choice: the first focusable). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Where focus goes on close, if not back to the opener. */
  returnFocus?: () => HTMLElement | null | undefined;
  onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useEffectEvent(onClose);
  const target = useEffectEvent(() => returnFocus?.());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    initialFocus?.current?.focus();
    // Escape fires `cancel`; React state decides whether the dialog closes.
    const onCancel = (e: Event) => {
      e.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      const back = target() ?? opener;
      if (back?.isConnected) back.focus();
    };
    // Runs once per mount; `initialFocus` is a stable ref.
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={label}
      aria-modal="true"
      onKeyDown={onKeyDown}
      // A click on the backdrop lands on the <dialog> itself.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={
        "m-auto overflow-hidden rounded-[8px] border border-border-strong bg-raised p-0 text-text " +
        "shadow-[0_24px_64px_-12px_rgba(0,0,0,0.8)] backdrop:bg-black/60 " +
        className
      }
    >
      {children}
    </dialog>
  );
}

/**
 * Overlays (Dialog, ConfirmDialog, Sheet, CommandPalette) call this from `onPointerDownOutside` /
 * `onInteractOutside`: a click on a toast (its Undo, its ×) is not "outside", so it never closes the
 * dialog under it.
 */
export function keepOpenForToasts(event: { target: EventTarget | null; detail?: { originalEvent?: Event }; preventDefault: () => void }) {
  const target = (event.detail?.originalEvent?.target ?? event.target) as Element | null;
  if (target && typeof target.closest === "function" && target.closest("[data-kore-toast]")) event.preventDefault();
}

/** Compose a user handler with {@link keepOpenForToasts}. */
export function withToastGuard<E extends { target: EventTarget | null; preventDefault: () => void }>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    keepOpenForToasts(event as never);
    handler?.(event);
  };
}

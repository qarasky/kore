"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Returns focus to whatever had it when an overlay opened, even when the overlay was opened
 * without a Radix Trigger (controlled `open`, opened from a menu item that still exists, …).
 * Render <CaptureOpener /> inside the overlay content; pass `onCloseAutoFocus` to it.
 */
export function useReturnFocus(userHandler?: (e: Event) => void) {
  const opener = useRef<HTMLElement | null>(null);
  const capture = useCallback(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);
  const onCloseAutoFocus = useCallback(
    (e: Event) => {
      userHandler?.(e);
      if (e.defaultPrevented) return;
      const el = opener.current;
      opener.current = null;
      if (el?.isConnected) {
        e.preventDefault();
        el.focus();
      }
    },
    [userHandler],
  );
  return { capture, onCloseAutoFocus };
}

/** Calls `onMount` in a layout effect, i.e. before the overlay moves focus inside. */
export function CaptureOpener({ onMount }: { onMount: () => void }) {
  useLayoutEffect(() => onMount(), [onMount]);
  return null;
}

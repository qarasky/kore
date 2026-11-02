"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placePopover } from "@/lib/popover";

/**
 * A panel anchored to an element (an event, a button). It sits to the right
 * of the anchor, or the left near the edge, follows it while the page scrolls,
 * and closes on Escape or a press outside. Focus moves into it when it opens
 * and back to the anchor when it closes.
 */
export function Popover({
  anchor,
  label,
  onClose,
  width = 340,
  children,
}: {
  anchor: HTMLElement;
  label: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState(false);
  const close = useEffectEvent(onClose);

  const place = useEffectEvent(() => {
    const el = ref.current;
    if (!el || !anchor.isConnected) return;
    const a = anchor.getBoundingClientRect();
    const { left, top } = placePopover(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    setPlaced(true);
  });

  useLayoutEffect(() => {
    place();
  }, []);

  useEffect(() => {
    const el = ref.current;
    el?.focus();
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!el?.contains(n) && !anchor.contains(n)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const reposition = () => place();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
      if (anchor.isConnected) anchor.focus();
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      style={{ position: "fixed", left: 0, top: 0, width, maxWidth: "calc(100vw - 16px)", visibility: placed ? "visible" : "hidden" }}
      className="z-50 max-h-[calc(100vh-16px)] overflow-y-auto rounded-[8px] border border-border-strong bg-raised text-text shadow-[0_16px_48px_-8px_rgba(0,0,0,0.75)] outline-none"
    >
      {children}
    </div>,
    document.body,
  );
}

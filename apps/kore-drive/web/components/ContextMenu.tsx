"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MenuPanel, type CloseReason, type MenuAction } from "./Menu";

const MARGIN = 8;

/**
 * A {@link MenuPanel} at viewport coordinates (from a right-click, or a row's
 * position for the keyboard), rendered in a portal and kept on screen.
 */
export function ContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: MenuAction[];
  onClose: (reason: CloseReason) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Measure after layout and flip/clamp so the menu never leaves the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - width) : x;
    const top = y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - height) : y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [x, y]);

  return createPortal(
    <MenuPanel
      panelRef={ref}
      label={label}
      items={items}
      onClose={onClose}
      className="fixed"
      style={{ left: x, top: y, visibility: "hidden" }}
    />,
    document.body,
  );
}

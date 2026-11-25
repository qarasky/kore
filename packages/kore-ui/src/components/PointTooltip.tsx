"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

export type PointTooltipProps = {
  /** Where the pointer is (viewport coordinates). `null` hides the tooltip. */
  point: { x: number; y: number } | null;
  /** Text only (13px). Never the only place a fact lives. */
  children: ReactNode;
  /** Set it on the hovered element's `aria-describedby` so assistive tech reads the text. */
  id?: string;
  className?: string;
};

const GAP = 12;
const MARGIN = 8;

/**
 * A tooltip that follows a point instead of sitting on an element: the cell of a heatmap, a bar of a chart, one beat of
 * a heartbeat strip. Same look as `Tooltip`, never takes the pointer, and stays inside the viewport (flipping above
 * or to the left of the point when it would overflow). Drive `point` from `onPointerMove`/`onPointerLeave`.
 */
export function PointTooltip({ point, children, id, className }: PointTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!point || !el) return setPos(null);
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = point.x + GAP;
    let top = point.y + GAP;
    if (left + width > vw - MARGIN) left = Math.max(MARGIN, point.x - GAP - width);
    if (top + height > vh - MARGIN) top = Math.max(MARGIN, point.y - GAP - height);
    setPos({ left, top });
  }, [point, children]);

  if (!point || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{ left: pos?.left ?? point.x + GAP, top: pos?.top ?? point.y + GAP, visibility: pos ? "visible" : "hidden" }}
      className={cn(
        "pointer-events-none fixed z-(--z-tooltip) max-w-[280px] rounded-ui border border-border-strong bg-raised px-2 py-1 text-meta text-text shadow-overlay",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

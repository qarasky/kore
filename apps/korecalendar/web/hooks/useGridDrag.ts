"use client";

import { useEffect, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { GridDragController, placedId, type Ghost } from "@/lib/gridDrag";
import type { Placed } from "@/lib/layout";

export { placedId };
export type { Ghost };

/**
 * Dragging on the time grid: drag empty space to create, an event to move it,
 * its bottom edge to resize it (Escape cancels; Alt+arrows and Shift+Up/Down
 * do the same from the keyboard). Dropping calls back with whole-day and
 * snapped-minute amounts. `ghost` is what to draw meanwhile; after a drop it
 * stays until `settle()` is called with fresh data on screen.
 */
export function useGridDrag({
  days,
  areaRef,
  onCreate,
  onMove,
  onResize,
}: {
  days: string[];
  areaRef: RefObject<HTMLElement | null>;
  onCreate: (range: { day: string; startMinutes: number; endMinutes: number }) => void;
  onMove: (placed: Placed, move: { deltaDays: number; deltaMinutes: number }) => void;
  onResize: (placed: Placed, durationMinutes: number) => void;
}) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [dropped, setDropped] = useState(false);
  const [controller] = useState(
    () =>
      new GridDragController({
        area: () => null,
        days: () => [],
        setGhost: () => {},
        setDropped: () => {},
        onCreate: () => {},
        onMove: () => {},
        onResize: () => {},
      }),
  );

  // Hand the controller the latest geometry and callbacks after every render.
  useEffect(() => {
    controller.setHost({
      area: () => {
        const r = areaRef.current?.getBoundingClientRect();
        return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
      },
      days: () => days,
      setGhost,
      setDropped,
      onCreate,
      onMove,
      onResize,
    });
  }, [controller, areaRef, days, onCreate, onMove, onResize]);
  useEffect(() => () => controller.dispose(), [controller]);

  return {
    ghost,
    dropped,
    settle: () => {
      setGhost(null);
      setDropped(false);
    },
    startCreate: (e: PointerEvent) => controller.begin("create", e),
    startMove: (e: PointerEvent, placed: Placed) => controller.begin("move", e, placed),
    startResize: (e: PointerEvent, placed: Placed) => {
      e.stopPropagation();
      controller.begin("resize", e, placed);
    },
    keyboard: (e: KeyboardEvent, placed: Placed) => controller.key(e, placed),
    /** Put on the scroller's `onClickCapture`: swallows the click that ends a drag. */
    swallowClick: (e: MouseEvent) => {
      if (controller.consumeClick()) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}

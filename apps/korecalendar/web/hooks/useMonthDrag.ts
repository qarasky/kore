"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { exceedsThreshold, monthMoveDelta } from "@/lib/drag";
import type { Occurrence } from "@/lib/types";

type Session = { occ: Occurrence; fromDay: string; origin: { x: number; y: number }; active: boolean; over: string | null };

const cellAt = (x: number, y: number): string | null =>
  (document.elementFromPoint(x, y)?.closest("[data-testid=month-cell]") as HTMLElement | null)?.dataset.day ?? null;

/**
 * Dragging an event chip to another day in the month grid. The chip keeps its
 * time; only the day changes. `over` is the day under the pointer (to
 * highlight); `dragging` the occurrence being dragged.
 */
export function useMonthDrag(onMove: (occ: Occurrence, deltaDays: number) => void) {
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const suppress = useRef(false);
  const callback = useRef(onMove);

  useEffect(() => {
    callback.current = onMove;
  }, [onMove]);

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const s = session.current;
      if (!s) return;
      let cur = s;
      if (!s.active) {
        if (!exceedsThreshold(s.origin, { x: e.clientX, y: e.clientY })) return;
        cur = { ...s, active: true };
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        setDragging(s.occ.event_id + s.occ.key);
      }
      session.current = { ...cur, over: cellAt(e.clientX, e.clientY) };
      setOver(session.current.over);
    };
    const end = (commit: boolean) => {
      const s = session.current;
      session.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setOver(null);
      setDragging(null);
      if (!s || !s.active) return;
      suppress.current = true;
      if (commit) {
        setTimeout(() => {
          suppress.current = false;
        }, 0);
      } else {
        // Cancelled (Escape): the release that follows still fires a click, so ignore that one.
        window.addEventListener(
          "pointerup",
          () =>
            setTimeout(() => {
              suppress.current = false;
            }, 0),
          { once: true },
        );
      }
      const delta = s.over ? monthMoveDelta(s.fromDay, s.over) : 0;
      if (commit && delta !== 0) callback.current(s.occ, delta);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session.current) {
        e.stopPropagation();
        end(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  return {
    over,
    dragging,
    start: (e: PointerEvent, occ: Occurrence, fromDay: string) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      session.current = { occ, fromDay, origin: { x: e.clientX, y: e.clientY }, active: false, over: null };
    },
    swallowClick: (e: MouseEvent) => {
      if (suppress.current) {
        e.stopPropagation();
        e.preventDefault();
        suppress.current = false;
      }
    },
  };
}

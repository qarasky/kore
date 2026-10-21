"use client";

import { useState, type DragEvent } from "react";

/**
 * Drop-target wiring for one element: `active` is true while an accepted
 * drag hovers it (for the highlight). Unaccepted drags are left alone, so
 * the browser shows "not allowed" and the event bubbles on.
 */
export function useDropTarget<E extends HTMLElement>({
  accepts,
  onDrop,
  effect = "move",
}: {
  accepts: (e: DragEvent<E>) => boolean;
  onDrop: (e: DragEvent<E>) => void;
  effect?: DataTransfer["dropEffect"] | ((e: DragEvent<E>) => DataTransfer["dropEffect"]);
}) {
  const [active, setActive] = useState(false);
  const dropEffect = (e: DragEvent<E>) => (typeof effect === "function" ? effect(e) : effect);
  return {
    active,
    props: {
      onDragOver: (e: DragEvent<E>) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = dropEffect(e);
        if (!active) setActive(true);
      },
      onDragLeave: (e: DragEvent<E>) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setActive(false);
      },
      onDrop: (e: DragEvent<E>) => {
        setActive(false);
        if (!accepts(e)) return;
        e.preventDefault();
        onDrop(e);
      },
    },
  };
}

"use client";

import { useState } from "react";
import {
  clearSelection,
  clickSelect,
  EMPTY_SELECTION,
  moveSelect,
  orderedSelection,
  pruneSelection,
  selectAll,
  type ClickMods,
  type Selection,
} from "@/lib/selection";

/**
 * React state around the pure model in `lib/selection`. `ids` is the current
 * row order; ids that disappear (after a refresh) are dropped at render time,
 * so the selection can never point at rows that are not on screen.
 * `initial` starts with that one row selected (e.g. `?select=<id>`).
 */
export function useSelection(ids: readonly string[], initial: string | null = null) {
  const [raw, setRaw] = useState<Selection>(() =>
    initial === null ? EMPTY_SELECTION : { selected: new Set([initial]), anchor: initial, focus: initial },
  );
  const selection = pruneSelection(raw, ids);
  const update = (fn: (s: Selection) => Selection) => setRaw((prev) => fn(pruneSelection(prev, ids)));

  return {
    selection,
    /** Selected ids in list order. */
    selectedIds: orderedSelection(selection, ids),
    isSelected: (id: string) => selection.selected.has(id),
    click: (id: string, mods?: ClickMods) => update((s) => clickSelect(s, ids, id, mods)),
    /** Moves the cursor by `delta` rows; returns the newly focused id. */
    move: (delta: number, shift = false): string | null => {
      const next = moveSelect(selection, ids, delta, { shift });
      setRaw(next);
      return next.focus;
    },
    selectAll: () => update((s) => selectAll(s, ids)),
    clear: () => update(clearSelection),
    /** Selects exactly `id` (which may not be in the list yet, e.g. a folder
     *  just created whose row arrives with the next refresh). */
    only: (id: string) => setRaw({ selected: new Set([id]), anchor: id, focus: id }),
  };
}

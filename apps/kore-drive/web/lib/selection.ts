/**
 * Pure list-selection model (file-manager semantics), kept free of React so
 * it can be unit tested. `ids` is always the current row order.
 *
 * - `anchor`: where a shift-range starts (last plain or toggle click).
 * - `focus`: the row with the roving tabindex / keyboard cursor.
 */
export type Selection = {
  selected: ReadonlySet<string>;
  anchor: string | null;
  focus: string | null;
};

export const EMPTY_SELECTION: Selection = { selected: new Set(), anchor: null, focus: null };

/** The ids from `from` to `to` inclusive, in list order (either direction). */
export function rangeBetween(ids: readonly string[], from: string | null, to: string): string[] {
  const end = ids.indexOf(to);
  if (end < 0) return [];
  let start = from === null ? -1 : ids.indexOf(from);
  if (start < 0) start = end;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return ids.slice(lo, hi + 1);
}

export type ClickMods = { shift?: boolean; toggle?: boolean };

/**
 * A click on row `id`. Plain click selects only it; toggle (Ctrl/Cmd) flips
 * it; shift selects the range from the anchor (added to the existing
 * selection when combined with toggle).
 */
export function clickSelect(s: Selection, ids: readonly string[], id: string, mods: ClickMods = {}): Selection {
  if (!ids.includes(id)) return s;
  if (mods.shift) {
    const anchor = s.anchor !== null && ids.includes(s.anchor) ? s.anchor : id;
    const range = rangeBetween(ids, anchor, id);
    const selected = new Set(mods.toggle ? [...s.selected, ...range] : range);
    return { selected, anchor, focus: id };
  }
  if (mods.toggle) {
    const selected = new Set(s.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { selected, anchor: id, focus: id };
  }
  return { selected: new Set([id]), anchor: id, focus: id };
}

/**
 * Moves the cursor by `delta` rows (clamped). Without shift the selection
 * follows the cursor; with shift it becomes the range anchor..cursor.
 * With nothing focused, any move lands on the first (down) or last (up) row.
 */
export function moveSelect(
  s: Selection,
  ids: readonly string[],
  delta: number,
  mods: { shift?: boolean } = {},
): Selection {
  if (ids.length === 0) return s;
  const cur = s.focus === null ? -1 : ids.indexOf(s.focus);
  let next: number;
  if (cur < 0) next = delta >= 0 ? 0 : ids.length - 1;
  else next = Math.min(ids.length - 1, Math.max(0, cur + delta));
  const id = ids[next];
  if (mods.shift) {
    const anchor = s.anchor !== null && ids.includes(s.anchor) ? s.anchor : (s.focus ?? id);
    return { selected: new Set(rangeBetween(ids, anchor, id)), anchor, focus: id };
  }
  return { selected: new Set([id]), anchor: id, focus: id };
}

export function selectAll(s: Selection, ids: readonly string[]): Selection {
  return { selected: new Set(ids), anchor: s.anchor, focus: s.focus ?? ids[0] ?? null };
}

/** Clears the selection but keeps the keyboard cursor where it was. */
export function clearSelection(s: Selection): Selection {
  return { selected: new Set(), anchor: null, focus: s.focus };
}

/** Drops ids that are no longer in the list (after a refresh). */
export function pruneSelection(s: Selection, ids: readonly string[]): Selection {
  const live = new Set(ids);
  const selected = [...s.selected].filter((id) => live.has(id));
  const anchor = s.anchor !== null && live.has(s.anchor) ? s.anchor : null;
  const focus = s.focus !== null && live.has(s.focus) ? s.focus : null;
  if (selected.length === s.selected.size && anchor === s.anchor && focus === s.focus) return s;
  return { selected: new Set(selected), anchor, focus };
}

/** Selected ids in list order. */
export function orderedSelection(s: Selection, ids: readonly string[]): string[] {
  return ids.filter((id) => s.selected.has(id));
}

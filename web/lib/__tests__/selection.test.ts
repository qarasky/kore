import { describe, expect, it } from "vitest";
import {
  clearSelection,
  clickSelect,
  EMPTY_SELECTION,
  moveSelect,
  orderedSelection,
  pruneSelection,
  rangeBetween,
  selectAll,
  type Selection,
} from "../selection";

const ids = ["a", "b", "c", "d", "e"];
const sel = (s: Selection) => orderedSelection(s, ids);

describe("rangeBetween", () => {
  it("is inclusive in both directions", () => {
    expect(rangeBetween(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(ids, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(ids, "c", "c")).toEqual(["c"]);
  });

  it("falls back to the target alone when the anchor is missing", () => {
    expect(rangeBetween(ids, null, "c")).toEqual(["c"]);
    expect(rangeBetween(ids, "gone", "c")).toEqual(["c"]);
    expect(rangeBetween(ids, "a", "gone")).toEqual([]);
  });
});

describe("clickSelect", () => {
  it("plain click selects only that row and sets anchor and focus", () => {
    const s = clickSelect(clickSelect(EMPTY_SELECTION, ids, "a"), ids, "c");
    expect(sel(s)).toEqual(["c"]);
    expect(s.anchor).toBe("c");
    expect(s.focus).toBe("c");
  });

  it("shift-click selects the range from the anchor, keeping the anchor", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b");
    s = clickSelect(s, ids, "d", { shift: true });
    expect(sel(s)).toEqual(["b", "c", "d"]);
    expect(s.anchor).toBe("b");
    // Shrinking the range from the same anchor.
    s = clickSelect(s, ids, "a", { shift: true });
    expect(sel(s)).toEqual(["a", "b"]);
    expect(s.focus).toBe("a");
  });

  it("shift-click with no anchor selects just the row", () => {
    expect(sel(clickSelect(EMPTY_SELECTION, ids, "c", { shift: true }))).toEqual(["c"]);
  });

  it("toggle flips one row and moves the anchor", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "a");
    s = clickSelect(s, ids, "c", { toggle: true });
    expect(sel(s)).toEqual(["a", "c"]);
    s = clickSelect(s, ids, "a", { toggle: true });
    expect(sel(s)).toEqual(["c"]);
    expect(s.anchor).toBe("a");
  });

  it("shift+toggle adds the range to the existing selection", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "a");
    s = clickSelect(s, ids, "c", { toggle: true });
    s = clickSelect(s, ids, "e", { shift: true, toggle: true });
    expect(sel(s)).toEqual(["a", "c", "d", "e"]);
  });

  it("ignores ids not in the list", () => {
    const s = clickSelect(EMPTY_SELECTION, ids, "a");
    expect(clickSelect(s, ids, "zzz")).toBe(s);
  });
});

describe("moveSelect", () => {
  it("starts at the first row going down and the last going up", () => {
    expect(sel(moveSelect(EMPTY_SELECTION, ids, 1))).toEqual(["a"]);
    expect(sel(moveSelect(EMPTY_SELECTION, ids, -1))).toEqual(["e"]);
  });

  it("moves and clamps at the ends", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "d");
    s = moveSelect(s, ids, 1);
    expect(sel(s)).toEqual(["e"]);
    s = moveSelect(s, ids, 1);
    expect(sel(s)).toEqual(["e"]);
    expect(s.focus).toBe("e");
  });

  it("extends a range with shift", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b");
    s = moveSelect(s, ids, 1, { shift: true });
    s = moveSelect(s, ids, 1, { shift: true });
    expect(sel(s)).toEqual(["b", "c", "d"]);
    s = moveSelect(s, ids, -3, { shift: true });
    expect(sel(s)).toEqual(["a", "b"]);
    expect(s.anchor).toBe("b");
  });

  it("does nothing on an empty list", () => {
    expect(moveSelect(EMPTY_SELECTION, [], 1)).toBe(EMPTY_SELECTION);
  });
});

describe("selectAll / clear / prune", () => {
  it("selects everything and keeps the cursor", () => {
    const s = selectAll(clickSelect(EMPTY_SELECTION, ids, "c"), ids);
    expect(sel(s)).toEqual(ids);
    expect(s.focus).toBe("c");
    expect(selectAll(EMPTY_SELECTION, ids).focus).toBe("a");
  });

  it("clear keeps focus but drops selection and anchor", () => {
    const s = clearSelection(clickSelect(EMPTY_SELECTION, ids, "c"));
    expect(sel(s)).toEqual([]);
    expect(s.anchor).toBeNull();
    expect(s.focus).toBe("c");
  });

  it("prune drops vanished ids and returns the same object when nothing changed", () => {
    let s = clickSelect(EMPTY_SELECTION, ids, "b");
    s = clickSelect(s, ids, "d", { shift: true });
    expect(pruneSelection(s, ids)).toBe(s);
    const p = pruneSelection(s, ["a", "c", "e"]);
    expect([...p.selected]).toEqual(["c"]);
    expect(p.anchor).toBeNull();
    expect(p.focus).toBeNull();
  });
});

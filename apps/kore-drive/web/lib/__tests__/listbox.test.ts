import { describe, expect, it } from "vitest";
import { opensAbove, stepIndex, typeaheadIndex } from "../listbox";

const opts = [
  { label: "Apple" },
  { label: "apricot", disabled: true },
  { label: "Banana" },
  { label: "blueberry" },
  { label: "Cherry", disabled: true },
];

describe("stepIndex", () => {
  it("moves to the next/previous enabled option without wrapping", () => {
    expect(stepIndex(opts, 0, "next")).toBe(2); // skips disabled "apricot"
    expect(stepIndex(opts, 2, "next")).toBe(3);
    expect(stepIndex(opts, 3, "next")).toBe(3); // "Cherry" is disabled: stay
    expect(stepIndex(opts, 2, "prev")).toBe(0);
    expect(stepIndex(opts, 0, "prev")).toBe(0);
  });
  it("Home/End go to the first/last enabled option", () => {
    expect(stepIndex(opts, 3, "first")).toBe(0);
    expect(stepIndex(opts, 0, "last")).toBe(3);
  });
  it("starts from nothing (-1)", () => {
    expect(stepIndex(opts, -1, "next")).toBe(0);
    expect(stepIndex(opts, -1, "prev")).toBe(0);
  });
  it("returns -1 when every option is disabled", () => {
    expect(stepIndex([{ label: "x", disabled: true }], -1, "first")).toBe(-1);
  });
});

describe("typeaheadIndex", () => {
  it("finds the first enabled option starting with the typed text, case-insensitively", () => {
    expect(typeaheadIndex(opts, "b", 0)).toBe(2);
    expect(typeaheadIndex(opts, "BL", 0)).toBe(3);
    expect(typeaheadIndex(opts, "ap", 2)).toBe(0); // "apricot" is disabled
  });
  it("a repeated letter cycles through the matches after the current one", () => {
    expect(typeaheadIndex(opts, "b", 2)).toBe(3);
    expect(typeaheadIndex(opts, "bb", 3)).toBe(2);
  });
  it("a longer query keeps the current option while it still matches", () => {
    expect(typeaheadIndex(opts, "ba", 2)).toBe(2);
  });
  it("returns -1 without a match", () => {
    expect(typeaheadIndex(opts, "z", 0)).toBe(-1);
    expect(typeaheadIndex(opts, "c", 0)).toBe(-1);
  });
  it("matches units like GB/TB", () => {
    const units = [{ label: "MB" }, { label: "GB" }, { label: "TB" }];
    expect(typeaheadIndex(units, "t", 0)).toBe(2);
    expect(typeaheadIndex(units, "g", 2)).toBe(1);
  });
});

describe("opensAbove", () => {
  it("opens below when there is room", () => {
    expect(opensAbove({ top: 100, bottom: 130 }, 200, 800)).toBe(false);
  });
  it("opens above when it doesn't fit below and there is more room above", () => {
    expect(opensAbove({ top: 700, bottom: 730 }, 200, 800)).toBe(true);
  });
  it("stays below when above has even less room", () => {
    expect(opensAbove({ top: 60, bottom: 90 }, 900, 800)).toBe(false);
  });
});

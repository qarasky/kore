import { describe, expect, it } from "vitest";
import en from "../i18n/en";
import { CATEGORY_KEYS, categoryColor, categoryLabelKey, largestHref, sharePercent, type Breakdown } from "../storage";

describe("storage categories", () => {
  it("mirror the Go category keys (api/internal/quota/category.go)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../../api/internal/quota/category.go", import.meta.url), "utf8");
    const keys = [...src.matchAll(/Cat\w+\s+=\s+"(\w+)"/g)].map((m) => m[1]);
    expect(keys.length).toBe(7);
    expect([...CATEGORY_KEYS].sort()).toEqual(keys.sort());
  });

  it("have a label and a distinct colour each", () => {
    const colors = new Set<string>();
    for (const k of CATEGORY_KEYS) {
      expect(en[categoryLabelKey(k)], k).toBeTruthy();
      colors.add(categoryColor(k));
    }
    expect(colors.size).toBe(CATEGORY_KEYS.length);
  });

  it("falls back for an unknown key from a newer server", () => {
    expect(categoryLabelKey("holograms")).toBe(categoryLabelKey("other"));
    expect(categoryColor("holograms")).toBe(categoryColor("other"));
  });
});

describe("sharePercent", () => {
  it("is the part of used, guarded against zero", () => {
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(1, 0)).toBe(0);
    expect(sharePercent(150, 100)).toBe(100);
  });
});

describe("largestHref", () => {
  const f: Breakdown["largest"][number] = { id: "abc", name: "x.mp4", size: 1, space: "shared", parent_id: null };
  it("opens the containing folder with the file selected", () => {
    expect(largestHref(f)).toBe("/shared?select=abc");
    expect(largestHref({ ...f, space: "personal", parent_id: "p 1" })).toBe("/files/p%201?select=abc");
  });
});

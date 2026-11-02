import { describe, expect, it } from "vitest";
import { SHORTCUTS, matchShortcut } from "@/lib/shortcuts";

const ev = (key: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; tag: string; editable: boolean; role: string }> = {}) => ({
  key,
  shiftKey: extra.shiftKey ?? false,
  ctrlKey: extra.ctrlKey ?? false,
  metaKey: extra.metaKey ?? false,
  altKey: extra.altKey ?? false,
  target: { tagName: extra.tag ?? "BODY", isContentEditable: extra.editable ?? false, role: extra.role ?? null },
});

describe("matchShortcut", () => {
  it.each([
    ["t", "today"],
    ["ArrowLeft", "prev"],
    ["k", "prev"],
    ["p", "prev"],
    ["ArrowRight", "next"],
    ["j", "next"],
    ["n", "next"],
    ["d", "viewDay"],
    ["w", "viewWeek"],
    ["m", "viewMonth"],
    ["a", "viewAgenda"],
    ["c", "create"],
    ["/", "search"],
    ["g", "goToDate"],
  ])("%s is %s", (key, id) => {
    expect(matchShortcut(ev(key))).toBe(id);
  });

  it("opens help with ? (typed with Shift)", () => {
    expect(matchShortcut(ev("?", { shiftKey: true }))).toBe("help");
  });

  it("leaves capital letters and other keys alone", () => {
    expect(matchShortcut(ev("T", { shiftKey: true }))).toBeNull();
    expect(matchShortcut(ev("x"))).toBeNull();
    expect(matchShortcut(ev("Enter"))).toBeNull();
    expect(matchShortcut(ev(" "))).toBeNull();
    expect(matchShortcut(ev("ArrowLeft", { shiftKey: true }))).toBeNull();
  });

  it("never fires while typing", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) expect(matchShortcut(ev("t", { tag }))).toBeNull();
    expect(matchShortcut(ev("t", { editable: true }))).toBeNull();
    for (const role of ["combobox", "listbox", "textbox", "menuitem", "option", "searchbox", "slider"]) {
      expect(matchShortcut(ev("t", { role }))).toBeNull();
    }
  });

  it("never fires with Ctrl, Cmd or Alt held (browser and app shortcuts keep working)", () => {
    expect(matchShortcut(ev("t", { ctrlKey: true }))).toBeNull();
    expect(matchShortcut(ev("w", { metaKey: true }))).toBeNull();
    expect(matchShortcut(ev("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("works from buttons and links (focus after clicking is not typing)", () => {
    expect(matchShortcut(ev("t", { tag: "BUTTON" }))).toBe("today");
    expect(matchShortcut(ev("w", { tag: "A" }))).toBe("viewWeek");
  });
});

describe("SHORTCUTS (the help table)", () => {
  it("documents every shortcut id exactly once", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["create", "goToDate", "help", "next", "prev", "search", "today", "viewAgenda", "viewDay", "viewMonth", "viewWeek"].sort());
  });

  it("lists the keys the matcher accepts", () => {
    for (const s of SHORTCUTS) {
      for (const key of s.keys) {
        const real = key === "?" ? ev("?", { shiftKey: true }) : ev(key);
        expect(matchShortcut(real), `${key} -> ${s.id}`).toBe(s.id);
      }
    }
  });
});

/** The keyboard shortcuts, and when a key press counts as one. Pure. */

export type ShortcutId =
  | "today"
  | "prev"
  | "next"
  | "viewDay"
  | "viewWeek"
  | "viewMonth"
  | "viewAgenda"
  | "create"
  | "search"
  | "help"
  | "goToDate";

/** The help dialog's table: each shortcut and the keys that trigger it. */
export const SHORTCUTS: readonly { id: ShortcutId; keys: readonly string[] }[] = [
  { id: "today", keys: ["t"] },
  { id: "prev", keys: ["ArrowLeft", "k", "p"] },
  { id: "next", keys: ["ArrowRight", "j", "n"] },
  { id: "viewDay", keys: ["d"] },
  { id: "viewWeek", keys: ["w"] },
  { id: "viewMonth", keys: ["m"] },
  { id: "viewAgenda", keys: ["a"] },
  { id: "create", keys: ["c"] },
  { id: "goToDate", keys: ["g"] },
  { id: "search", keys: ["/"] },
  { id: "help", keys: ["?"] },
];

const BY_KEY = new Map<string, ShortcutId>(SHORTCUTS.flatMap((s) => s.keys.map((k) => [k, s.id] as const)));

/** Elements where letters are text, not commands. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const TYPING_ROLES = new Set(["combobox", "listbox", "textbox", "searchbox", "menuitem", "option", "slider", "spinbutton"]);

export type KeyLike = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: { tagName: string; isContentEditable: boolean; role?: string | null };
};

/** Which shortcut a key press is, or null: never while typing or with Ctrl/Cmd/Alt held. */
export function matchShortcut(e: KeyLike): ShortcutId | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const { tagName, isContentEditable, role } = e.target;
  if (isContentEditable || TYPING_TAGS.has(tagName.toUpperCase()) || (role && TYPING_ROLES.has(role))) return null;
  const id = BY_KEY.get(e.key);
  if (!id) return null;
  // "?" is typed with Shift; every other key must be pressed plain.
  if (id === "help") return e.shiftKey || e.key === "?" ? id : null;
  return e.shiftKey ? null : id;
}

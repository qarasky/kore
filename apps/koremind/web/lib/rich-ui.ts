import type { Tone } from "@koremind/shared";
import { isNumericColumn } from "@koremind/shared";

/** Card tones on kore-ui's colour tokens. Written out in full so Tailwind finds every class. */
export const TONE_TEXT: Record<Tone, string> = { neutral: "text-text", good: "text-status-up", warn: "text-warning", bad: "text-danger", info: "text-accent" };
export const TONE_PILL: Record<Tone, string> = {
  neutral: "bg-raised text-muted", good: "bg-status-up/15 text-status-up", warn: "bg-warning/15 text-warning", bad: "bg-danger/15 text-danger", info: "bg-accent/15 text-accent",
};
export const TONE_FILL: Record<Tone, string> = { neutral: "bg-muted", good: "bg-status-up", warn: "bg-warning", bad: "bg-danger", info: "bg-accent" };

const BAR_CYCLE: Tone[] = ["good", "info", "warn"];
/** A bar's own tone, or the next one in the cycle so neighbouring bars differ. */
export const barTone = (tone: Tone | undefined, index: number): Tone => tone ?? BAR_CYCLE[index % BAR_CYCLE.length];

/** Messages may embed only https images; anything else (http, data:, javascript:) is not drawn. */
export const safeImageSrc = (src: string | undefined): string | null => (src && /^https:\/\//i.test(src) ? src : null);
export const hostOf = (src: string): string => {
  try { return new URL(src).hostname.replace(/^www\./, ""); } catch { return ""; }
};

/** "language-card" from react-markdown's class list (or string). "" when there is none. */
export const fenceLanguage = (className: unknown): string => {
  const list = Array.isArray(className) ? className : typeof className === "string" ? className.split(/\s+/) : [];
  const found = list.find((c): c is string => typeof c === "string" && c.startsWith("language-"));
  return found ? found.slice("language-".length) : "";
};

/** The slice of a hast tree we read; react-markdown hands these to component overrides and rehype plugins. */
export type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };
export const hastText = (n: HastNode): string => (n.type === "text" ? n.value ?? "" : (n.children ?? []).map(hastText).join(""));

/** Rehype plugin: in a table, a column whose cells are all numbers or amounts gets class "num" (right-aligned, tabular figures). */
export function numericColumnsPlugin() {
  const visit = (n: HastNode) => {
    if (n.type === "element" && n.tagName === "table") markTable(n);
    else (n.children ?? []).forEach(visit);
  };
  return (tree: HastNode) => visit(tree);
}

function rowsOf(table: HastNode): HastNode[] {
  const out: HastNode[] = [];
  const walk = (n: HastNode) => { if (n.type === "element" && n.tagName === "tr") out.push(n); else (n.children ?? []).forEach(walk); };
  walk(table);
  return out;
}
const cellsOf = (tr: HastNode) => (tr.children ?? []).filter((c) => c.type === "element" && (c.tagName === "td" || c.tagName === "th"));

function markTable(table: HastNode) {
  const rows = rowsOf(table);
  const bodyRows = rows.filter((r) => cellsOf(r).some((c) => c.tagName === "td")).map((r) => cellsOf(r).map(hastText));
  const width = Math.max(0, ...rows.map((r) => cellsOf(r).length));
  for (let i = 0; i < width; i++) {
    if (!isNumericColumn(bodyRows, i)) continue;
    for (const r of rows) {
      const c = cellsOf(r)[i];
      if (c) c.properties = { ...(c.properties ?? {}), className: ["num"] };
    }
  }
}

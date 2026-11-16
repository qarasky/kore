/**
 * Rich "cards" the assistant can put in a message: a fenced block ```card with JSON inside.
 * Web and Android both read them with the same rules (see fixtures/cards.json, run by both test suites)
 * and draw them natively. Anything that does not parse is shown as a plain code block, never as a broken card.
 */
export const TONES = ["neutral", "good", "warn", "bad", "info"] as const;
export type Tone = (typeof TONES)[number];

export type CardStat = { label: string; value: string; tone?: Tone };
export type CardBar = { label: string; value: string; share: number; tone?: Tone };
export type CardSection =
  | { type: "stats"; items: CardStat[] }
  | { type: "table"; columns: string[]; rows: string[][]; totalRow: boolean }
  | { type: "bars"; items: CardBar[] }
  | { type: "note"; text: string };
export type Card = { title?: string; subtitle?: string; badge?: { text: string; tone: Tone }; sections: CardSection[] };

export const CARD_LIMITS = { sections: 8, stats: 4, columns: 6, rows: 40, bars: 12, text: 600, short: 160 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Text from a string or a number; anything else is nothing. */
const text = (v: unknown, max: number): string | undefined => {
  const s = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
  const t = s?.trim();
  return t ? t.slice(0, max) : undefined;
};
const tone = (v: unknown): Tone | undefined => (TONES as readonly string[]).includes(v as string) ? (v as Tone) : undefined;
const clamp01 = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};
const withTone = <T extends object>(o: T, t: Tone | undefined): T => (t ? { ...o, tone: t } : o);

function section(raw: unknown): CardSection | null {
  if (!isObj(raw)) return null;
  const L = CARD_LIMITS;
  switch (raw.type) {
    case "stats": {
      const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((i): CardStat[] => {
        if (!isObj(i)) return [];
        const label = text(i.label, L.short), value = text(i.value, 40);
        return label && value ? [withTone({ label, value }, tone(i.tone))] : [];
      }).slice(0, L.stats);
      return items.length ? { type: "stats", items } : null;
    }
    case "table": {
      const columns = (Array.isArray(raw.columns) ? raw.columns : []).map((c) => text(c, 60) ?? "").slice(0, L.columns);
      if (!columns.length) return null;
      const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter(Array.isArray).slice(0, L.rows)
        .map((r) => columns.map((_, i) => text((r as unknown[])[i], L.short) ?? ""));
      return { type: "table", columns, rows, totalRow: raw.totalRow === true };
    }
    case "bars": {
      const items = (Array.isArray(raw.items) ? raw.items : []).flatMap((i): CardBar[] => {
        if (!isObj(i)) return [];
        const label = text(i.label, L.short), value = text(i.value, 40);
        return label && value ? [withTone({ label, value, share: clamp01(i.share) }, tone(i.tone))] : [];
      }).slice(0, L.bars);
      return items.length ? { type: "bars", items } : null;
    }
    case "note": {
      const t = text(raw.text, L.text);
      return t ? { type: "note", text: t } : null;
    }
    default: return null;
  }
}

/** The card in `raw` (the JSON between the fences), normalised, or null when it is not a usable card. */
export function parseCard(raw: string): Card | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v)) return null;
  const title = text(v.title, L_SHORT), subtitle = text(v.subtitle, L_SHORT);
  const badgeText = isObj(v.badge) ? text(v.badge.text, 40) : undefined;
  const badge = badgeText ? { text: badgeText, tone: tone((v.badge as Record<string, unknown>).tone) ?? "neutral" } : undefined;
  const sections = (Array.isArray(v.sections) ? v.sections : []).map(section).filter((s): s is CardSection => s !== null).slice(0, CARD_LIMITS.sections);
  if (!title && !subtitle && !badge && !sections.length) return null;
  return { ...(title ? { title } : {}), ...(subtitle ? { subtitle } : {}), ...(badge ? { badge } : {}), sections };
}
const L_SHORT = CARD_LIMITS.short;

const NUMBER = /^[~≈+\-−(]?\d[\d.,]*(%|[KMBkmb]|[x×])?([–—-][~≈]?\d[\d.,]*(%|[KMBkmb]|[x×])?)?\)?$/;
/** True when every non-empty cell of column `i` is a number, amount, range or dash: those columns are right-aligned. */
export function isNumericColumn(rows: string[][], i: number): boolean {
  const cells = rows.map((r) => r[i]).filter((c): c is string => c !== undefined && c.trim() !== "");
  if (!cells.length) return false;
  return cells.every((c) => {
    const t = c.replace(/[€$£¥₸₽]/g, "").replace(/\s+/g, "").trim();
    return /^[—–-]$/.test(t) || NUMBER.test(t);
  });
}

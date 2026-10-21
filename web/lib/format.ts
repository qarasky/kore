/**
 * Pure display formatters for sizes and timestamps. Locale-aware through
 * `Intl`, with every word coming from `t()` so another locale only needs a
 * dictionary.
 */
import { activeLocale, t } from "./i18n";

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** Human-readable size in binary units: "0 B", "900 B", "2.1 MB", "380 MB". */
export function formatBytes(bytes: number, locale: string = activeLocale()): string {
  if (!Number.isFinite(bytes) || bytes < 0) bytes = 0;
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  // One decimal below 10, whole numbers above; carry "1024 KB" up to "1 MB".
  let digits = i > 0 && v < 10 ? 1 : 0;
  let rounded = Number(v.toFixed(digits));
  if (rounded >= 1024 && i < UNITS.length - 1) {
    i++;
    rounded = 1;
    digits = 0;
  }
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, useGrouping: false }).format(rounded);
  return `${n} ${UNITS[i]}`;
}

function dayKey(d: Date, timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD, which compares as a calendar day.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Compact "modified" label for a Unix timestamp (seconds): "Today 14:05",
 * "Yesterday 09:12", "Oct 3" this year, "Oct 3, 2024" otherwise.
 * `timeZone` defaults to the runtime's (the browser's, on the client).
 */
export function formatModified(
  unixSeconds: number,
  now: Date = new Date(),
  opts: { locale?: string; timeZone?: string } = {},
): string {
  const locale = opts.locale ?? activeLocale();
  const { timeZone } = opts;
  const d = new Date(unixSeconds * 1000);
  const time = () =>
    new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

  const day = dayKey(d, timeZone);
  if (day === dayKey(now, timeZone)) return t("date.today", { time: time() });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (day === dayKey(yesterday, timeZone)) return t("date.yesterday", { time: time() });

  const sameYear = day.slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(d);
}

/** Full timestamp for tooltips, e.g. "Oct 3, 2026, 14:05". */
export function formatFullDate(unixSeconds: number, opts: { locale?: string; timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(opts.locale ?? activeLocale(), {
    timeZone: opts.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
  }).format(new Date(unixSeconds * 1000));
}

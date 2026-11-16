/**
 * Pure display formatter for sizes. Locale-aware through `Intl`. Moments in
 * time are shown by kore-ui's `Time` (see components/RelativeTime.tsx).
 */
import { activeLocale } from "./i18n";

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

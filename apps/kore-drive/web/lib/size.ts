/**
 * Human size input for admin forms (quota, max file size). Units are binary,
 * labelled like `formatBytes()` labels them: "GB" is 1024³ bytes, "TB" 1024⁴,
 * so "50 GB" typed here is exactly what the storage meter shows as "50 GB".
 */

export const SIZE_UNITS = {
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
} as const;

export type SizeUnit = keyof typeof SIZE_UNITS;

/** Units offered for quotas. */
export const QUOTA_UNITS: readonly SizeUnit[] = ["GB", "TB"];
/** Units offered for the maximum file size. */
export const FILE_SIZE_UNITS: readonly SizeUnit[] = ["MB", "GB", "TB"];

export function isSizeUnit(u: string): u is SizeUnit {
  return Object.hasOwn(SIZE_UNITS, u);
}

/**
 * Parses a non-negative decimal ("50", "1.5", "0,5", ".5") in `unit` to
 * whole bytes. Returns null for blank, malformed, negative or values beyond
 * what a JS number holds exactly.
 */
export function parseSize(input: string, unit: SizeUnit): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const bytes = Math.round(Number(s) * SIZE_UNITS[unit]);
  return Number.isSafeInteger(bytes) ? bytes : null;
}

/** Plain decimal with at most two fraction digits and no grouping ("1.5", "50"). */
function plain(n: number): string {
  return String(Number(n.toFixed(2)));
}

/**
 * Splits `bytes` into a value and the largest of `units` in which it is at
 * least 1 (else the smallest unit), for pre-filling a size input:
 * 50 GiB with GB/TB → { value: "50", unit: "GB" }; 1.5 TiB → { "1.5", "TB" }.
 * The value is rounded to two decimals, so callers that must not change an
 * untouched field compare the text, not the parsed bytes.
 */
export function splitSize(bytes: number, units: readonly SizeUnit[] = QUOTA_UNITS): { value: string; unit: SizeUnit } {
  const sorted = [...units].sort((a, b) => SIZE_UNITS[a] - SIZE_UNITS[b]);
  let unit = sorted[0];
  for (const u of sorted) if (bytes >= SIZE_UNITS[u]) unit = u;
  return { value: plain(Math.max(0, bytes) / SIZE_UNITS[unit]), unit };
}

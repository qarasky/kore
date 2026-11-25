/** Percent of `quota` used, 0..100 (a zero quota with any use is full). */
export function usagePercent(used: number, quota: number): number {
  if (quota > 0) return Math.min(100, (used / quota) * 100);
  return used > 0 ? 100 : 0;
}

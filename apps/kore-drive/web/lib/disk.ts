/** `GET /api/admin/disk` and how the admin overview presents it (pure). */

export type DiskInfo = {
  total_bytes: number;
  /** Blocks in use (total minus all free blocks, reserved ones included). */
  used_bytes: number;
  /** Space an unprivileged writer can still use (df's "Avail"). */
  free_bytes: number;
  /** Every user's quota usage summed (files by uploader, trash, open uploads). */
  kore_used_bytes: number;
  quota_allocated_bytes: number;
  /** e.g. "/data (/dev/md0, ext4)"; empty when unknown. */
  fs_path_label: string;
};

export type DiskLevel = "ok" | "warn" | "critical";

export const DISK_WARN_PERCENT = 85;
export const DISK_CRITICAL_PERCENT = 95;

export function diskLevel(percentUsed: number): DiskLevel {
  if (percentUsed >= DISK_CRITICAL_PERCENT) return "critical";
  if (percentUsed >= DISK_WARN_PERCENT) return "warn";
  return "ok";
}

export type DiskView = {
  kore: number;
  other: number;
  free: number;
  /** Blocks neither used nor available (ext4's root reserve). */
  reserved: number;
  /** used / (used + free), the way df computes "Use%". */
  percentUsed: number;
  /** Bar widths in percent of used + free (sums to 100, or all 0). */
  segments: { kore: number; other: number; free: number };
  level: DiskLevel;
  /** More quota handed out than there is free space. */
  overAllocated: boolean;
};

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function diskView(d: DiskInfo): DiskView {
  const used = nonNeg(d.used_bytes);
  const free = nonNeg(d.free_bytes);
  const total = nonNeg(d.total_bytes);
  // Kore's accounting can drift from the blocks on disk (sparse or not yet
  // written uploads), so never show more Kore than the disk has in use.
  const kore = Math.min(nonNeg(d.kore_used_bytes), used);
  const other = used - kore;
  const span = used + free;
  const pct = (n: number) => (span > 0 ? (n / span) * 100 : 0);
  const percentUsed = pct(used);
  return {
    kore,
    other,
    free,
    reserved: Math.max(0, total - span),
    percentUsed,
    segments: { kore: pct(kore), other: pct(other), free: pct(free) },
    level: diskLevel(percentUsed),
    overAllocated: nonNeg(d.quota_allocated_bytes) > free,
  };
}

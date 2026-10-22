import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";

/** Percent of `quota` used, 0..100 (a zero quota with any use is full). */
export function usagePercent(used: number, quota: number): number {
  if (quota > 0) return Math.min(100, (used / quota) * 100);
  return used > 0 ? 100 : 0;
}

/** "X of Y" with a bar (red above 90%, a note when over quota). */
export function UsageBar({ used, quota, label }: { used: number; quota: number; label: string }) {
  const pct = usagePercent(used, quota);
  const text = t("admin.usage.of", { used: formatBytes(used), quota: formatBytes(quota) });
  return (
    <div className="min-w-0">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={text}
        className="h-1.5 overflow-hidden rounded-full bg-border"
      >
        <div className={`h-full rounded-full ${pct > 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-meta text-muted">
        <span data-testid="usage-text" className="truncate">
          {text}
        </span>
        {used > quota && <span className="shrink-0 text-danger">{t("admin.usage.over")}</span>}
      </div>
    </div>
  );
}

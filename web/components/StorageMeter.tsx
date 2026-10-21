import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";

/** "X of Y used" with a bar; turns red above 90%. */
export function StorageMeter({ usage }: { usage: Usage }) {
  const { used_bytes: used, quota_bytes: quota } = usage;
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : used > 0 ? 100 : 0;
  const label = t("storage.used", { used: formatBytes(used), quota: formatBytes(quota) });
  return (
    <div data-testid="storage-meter" className="px-2.5">
      <div className="mb-1.5 text-[12px] font-medium text-muted">{t("storage.label")}</div>
      <div
        role="meter"
        aria-label={t("storage.label")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={label}
        className="h-1 overflow-hidden rounded-full bg-border"
      >
        <div
          className={`h-full rounded-full ${pct > 90 ? "bg-danger" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 text-[12px] text-muted">{label}</div>
    </div>
  );
}

import { Meter } from "@qarasky/kore-ui";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { usagePercent } from "@/lib/usage";

/** "X of Y" as a kore-ui Meter (warning from 80%, red from 90%), a note when over quota. */
export function UsageBar({ used, quota, label }: { used: number; quota: number; label: string }) {
  const text = t("admin.usage.of", { used: formatBytes(used), quota: formatBytes(quota) });
  return (
    <div className="min-w-0">
      <Meter label={label} hideLabel value={Math.round(usagePercent(used, quota))} max={100} valueText={text} className="gap-1" />
      {used > quota && <p className="mt-0.5 text-meta text-danger">{t("admin.usage.over")}</p>}
    </div>
  );
}

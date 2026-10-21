import type { DiskInfo } from "@/lib/disk";
import { diskView } from "@/lib/disk";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";

const SEGMENT = {
  kore: "bg-accent",
  other: "bg-muted/70",
  free: "bg-border-strong",
} as const;

const LEVEL_TEXT = { ok: "", warn: "text-warning", critical: "text-danger" } as const;
const LEVEL_BORDER = { ok: "border-border", warn: "border-warning/60", critical: "border-danger/70" } as const;

function Swatch({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-[2px] ${className}`} />;
}

/**
 * The disk holding the data directory: a segmented bar (Kore | other data
 * | free), total/used/free, percent used (amber from 85%, red from 95%,
 * with a plain-language warning) and allocated quotas against free space.
 * `disk` null: the API could not report it.
 */
export function DiskCard({ disk }: { disk: DiskInfo | null }) {
  if (!disk) {
    return (
      <section aria-labelledby="disk-heading" className="rounded-[8px] border border-border bg-bg/40 p-4">
        <h3 id="disk-heading" className="text-[13px] font-semibold">
          {t("admin.disk.title")}
        </h3>
        <p className="mt-1 text-[12px] text-muted">{t("admin.disk.unavailable")}</p>
      </section>
    );
  }
  const v = diskView(disk);
  const percent = Math.round(v.percentUsed);
  const valuetext = t("admin.disk.valuetext", {
    used: formatBytes(disk.used_bytes),
    total: formatBytes(disk.total_bytes),
    percent,
  });
  const stats: { key: string; label: string; value: number }[] = [
    { key: "total", label: t("admin.disk.total"), value: disk.total_bytes },
    { key: "used", label: t("admin.disk.used"), value: disk.used_bytes },
    { key: "free", label: t("admin.disk.free"), value: disk.free_bytes },
  ];
  return (
    <section
      aria-labelledby="disk-heading"
      data-level={v.level}
      className={`rounded-[8px] border bg-bg/40 p-4 ${LEVEL_BORDER[v.level]}`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h3 id="disk-heading" className="text-[13px] font-semibold">
            {t("admin.disk.title")}
          </h3>
          {disk.fs_path_label && (
            <p className="truncate text-[12px] text-muted" title={disk.fs_path_label}>
              {t("admin.disk.where", { label: disk.fs_path_label })}
            </p>
          )}
        </div>
        <p className={`shrink-0 text-[22px] font-semibold tracking-[-0.02em] tabular-nums ${LEVEL_TEXT[v.level]}`}>
          <span data-testid="disk-percent">{t("admin.disk.percent", { percent })}</span>{" "}
          <span className="text-[12px] font-normal text-muted">{t("admin.disk.percentLabel")}</span>
        </p>
      </div>

      <div
        role="meter"
        aria-label={t("admin.disk.title")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valuetext}
        className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-border"
      >
        <div className={SEGMENT.kore} style={{ width: `${v.segments.kore}%` }} />
        <div className={SEGMENT.other} style={{ width: `${v.segments.other}%` }} />
        <div className={SEGMENT.free} style={{ width: `${v.segments.free}%` }} />
      </div>

      <ul data-testid="disk-legend" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <li className="flex items-center gap-1.5">
          <Swatch className={SEGMENT.kore} />
          <span>{t("admin.disk.legendKore")}</span>
          <span className="text-text tabular-nums">{formatBytes(v.kore)}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch className={SEGMENT.other} />
          <span>{t("admin.disk.legendOther")}</span>
          <span className="text-text tabular-nums">{formatBytes(v.other)}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <Swatch className={SEGMENT.free} />
          <span>{t("admin.disk.legendFree")}</span>
          <span className="text-text tabular-nums">{formatBytes(v.free)}</span>
        </li>
      </ul>

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
        {stats.map((s) => (
          <div key={s.key}>
            <dt className="text-[12px] text-muted">{s.label}</dt>
            <dd data-testid={`disk-${s.key}`} className="text-[15px] font-semibold tabular-nums">
              {formatBytes(s.value)}
            </dd>
          </div>
        ))}
      </dl>

      {v.reserved > 0 && <p className="mt-2 text-[12px] text-muted">{t("admin.disk.reserved", { size: formatBytes(v.reserved) })}</p>}
      {v.level !== "ok" && (
        <p role="alert" className={`mt-2 text-[12.5px] font-medium ${LEVEL_TEXT[v.level]}`}>
          {v.level === "critical" ? t("admin.disk.critical") : t("admin.disk.warn")}
        </p>
      )}
      <p data-testid="disk-allocated" className={`mt-2 text-[12px] ${v.overAllocated ? "text-warning" : "text-muted"}`}>
        {t("admin.disk.allocated", {
          allocated: formatBytes(disk.quota_allocated_bytes),
          free: formatBytes(disk.free_bytes),
        })}
      </p>
      {v.overAllocated && <p className="mt-0.5 text-[12px] text-warning">{t("admin.disk.overAllocated")}</p>}
    </section>
  );
}

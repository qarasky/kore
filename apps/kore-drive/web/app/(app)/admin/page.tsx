import Link from "next/link";
import { UsageBar, usagePercent } from "@/components/admin/UsageBar";
import type { AdminUser, UsageRow } from "@/lib/admin";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";

export const metadata = { title: t("admin.overview.title") };

/** `/admin`: totals and a usage bar per user (no file names, ever). */
export default async function AdminOverview() {
  await requireAdmin();
  const [usage, users] = await Promise.all([
    api<UsageRow[]>("/api/admin/usage"),
    api<AdminUser[]>("/api/admin/users"),
  ]);
  const used = usage.reduce((n, u) => n + u.used_bytes, 0);
  const quota = usage.reduce((n, u) => n + u.quota_bytes, 0);
  const admins = users.filter((u) => u.role === "admin").length;
  const byUse = [...usage].sort(
    (a, b) => usagePercent(b.used_bytes, b.quota_bytes) - usagePercent(a.used_bytes, a.quota_bytes) || b.used_bytes - a.used_bytes,
  );

  return (
    <div className="mx-auto max-w-[880px] space-y-6 p-6">
      <h2 className="sr-only">{t("admin.overview.title")}</h2>
      <div className="grid grid-cols-2 gap-3">
        <section className="rounded-[8px] border border-border bg-bg/40 p-4">
          <h3 className="text-[12px] font-medium text-muted">{t("admin.overview.totalUsed")}</h3>
          <p data-testid="total-used" className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
            {formatBytes(used)}
          </p>
          <p className="text-[12px] text-muted">{t("admin.overview.allocated", { quota: formatBytes(quota) })}</p>
        </section>
        <section className="rounded-[8px] border border-border bg-bg/40 p-4">
          <h3 className="text-[12px] font-medium text-muted">{t("admin.overview.users")}</h3>
          <p data-testid="user-count" className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">
            {usage.length}
          </p>
          <p className="text-[12px] text-muted">
            {admins === 1 ? t("admin.overview.adminsOne") : t("admin.overview.adminsMany", { count: admins })}
          </p>
        </section>
      </div>

      <section aria-labelledby="usage-heading">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h3 id="usage-heading" className="text-[13px] font-semibold">
            {t("admin.overview.usage")}
          </h3>
          <Link href="/admin/users" className="text-[12px] text-accent hover:underline">
            {t("admin.overview.manageUsers")}
          </Link>
        </div>
        <p className="mb-3 text-[12px] text-muted">{t("admin.overview.privacy")}</p>
        <ul className="divide-y divide-border rounded-[8px] border border-border">
          {byUse.map((u) => (
            <li key={u.user_id} data-testid="usage-row" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-4 px-4 py-2.5">
              <span className="truncate" title={u.email}>
                {u.email}
              </span>
              <UsageBar used={u.used_bytes} quota={u.quota_bytes} label={t("admin.usage.bar", { email: u.email })} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

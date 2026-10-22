import { usagePercent } from "@/components/admin/UsageBar";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";
import { requireUser } from "@/lib/session";

export const metadata = { title: t("account.title") };

/** `/account`: who you are, your storage use, and changing your password. */
export default async function AccountPage() {
  const user = await requireUser();
  const usage = await api<Usage>("/api/me/usage");
  const pct = usagePercent(usage.used_bytes, usage.quota_bytes);
  const text = t("account.storageUsed", {
    used: formatBytes(usage.used_bytes),
    quota: formatBytes(usage.quota_bytes),
    percent: Math.round(pct),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <h1 className="text-heading font-semibold">{t("account.title")}</h1>
      </div>
      <div className="mx-auto max-w-[560px] space-y-8 p-6">
        <section>
          <p className="truncate text-title font-semibold" title={user.email}>
            {user.email}
          </p>
          <p className="text-meta text-muted">
            {t("account.role", { role: user.role === "admin" ? t("admin.role.admin") : t("admin.role.user") })}
          </p>
        </section>

        <section aria-labelledby="storage-heading" className="space-y-2">
          <h2 id="storage-heading" className="text-sub font-semibold">
            {t("account.storageTitle")}
          </h2>
          <div
            role="meter"
            aria-label={t("account.storageTitle")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-valuetext={text}
            className="h-2 overflow-hidden rounded-full bg-border"
          >
            <div className={`h-full rounded-full ${pct > 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
          </div>
          <p data-testid="account-usage" className="text-muted">
            {text}
          </p>
          <p className="text-meta text-muted">{t("account.storageNote")}</p>
        </section>

        <section aria-labelledby="password-heading" className="space-y-3">
          <div>
            <h2 id="password-heading" className="text-sub font-semibold">
              {t("account.passwordTitle")}
            </h2>
            <p className="text-meta text-muted">{t("account.passwordHint")}</p>
          </div>
          <ChangePasswordForm />
        </section>
      </div>
    </div>
  );
}

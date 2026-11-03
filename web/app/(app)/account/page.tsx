import { usagePercent } from "@/components/admin/UsageBar";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { api } from "@/lib/api";
import { getAuthConfig } from "@/lib/authConfig";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";
import { requireUser } from "@/lib/session";
import { accountSsoMessage } from "@/lib/ssoErrors";

export const metadata = { title: t("account.title") };

/** `/account`: who you are, your storage use, and changing your password. */
export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser();
  const auth = await getAuthConfig();
  const sso = accountSsoMessage((await searchParams).sso);
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

        {auth.local_login ? (
          <section aria-labelledby="password-heading" className="space-y-3">
            <div>
              <h2 id="password-heading" className="text-sub font-semibold">
                {t("account.passwordTitle")}
              </h2>
              <p className="text-meta text-muted">{t("account.passwordHint")}</p>
            </div>
            <ChangePasswordForm />
          </section>
        ) : null}

        {auth.oidc ? (
          <section aria-labelledby="sso-heading" className="space-y-3">
            <div>
              <h2 id="sso-heading" className="text-sub font-semibold">
                {t("account.sso.title")}
              </h2>
              <p className="text-meta text-muted">{t("account.sso.hint")}</p>
            </div>
            {sso ? (
              <p role="status" data-testid="account-sso-result" className={`text-meta ${sso.ok ? "text-muted" : "text-danger"}`}>
                {t(sso.key)}
              </p>
            ) : null}
            <a
              href="/api/auth/oidc/login?link=1"
              className="inline-flex min-h-control items-center rounded-ui border border-border bg-raised px-3 py-2 font-medium text-text transition-colors hover:border-border-strong"
            >
              {t("account.sso.link")}
            </a>
          </section>
        ) : null}
      </div>
    </div>
  );
}

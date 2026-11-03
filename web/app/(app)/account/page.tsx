import { Button, Meter, PageBody, PageHeader, SettingsSection } from "@qarasky/kore-ui";
import { api } from "@/lib/api";
import { getAuthConfig } from "@/lib/authConfig";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Usage } from "@/lib/nodes";
import { requireUser } from "@/lib/session";
import { accountSsoMessage } from "@/lib/ssoErrors";
import { usagePercent } from "@/lib/usage";

export const metadata = { title: t("account.title") };

/** `/account`: who you are, your storage use, and the Kore ID link. */
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

  const koreIdAccount = auth.oidc && auth.issuer ? `${auth.issuer}/account` : null;
  return (
    <>
      <PageHeader title={t("account.title")} />
      <PageBody width="form">
        <SettingsSection
          title={<span className="block truncate" title={user.email}>{user.email}</span>}
          description={t("account.role", { role: user.role === "admin" ? t("admin.role.admin") : t("admin.role.user") })}
          actions={
            koreIdAccount ? (
              <Button size="sm" asChild>
                <a href={koreIdAccount}>{t("account.koreId")}</a>
              </Button>
            ) : null
          }
        />

        <SettingsSection title={t("account.storageTitle")} description={t("account.storageNote")}>
          <Meter label={t("account.storageTitle")} hideLabel value={Math.round(pct)} max={100} valueText={text} />
          <p data-testid="account-usage" className="sr-only">
            {text}
          </p>
        </SettingsSection>

        {auth.oidc ? (
          <SettingsSection title={t("account.sso.title")} description={t("account.sso.hint")}>
            {sso ? (
              <p role="status" data-testid="account-sso-result" className={`text-meta ${sso.ok ? "text-muted" : "text-danger"}`}>
                {t(sso.key)}
              </p>
            ) : null}
            <div>
              <Button asChild>
                <a href="/api/auth/oidc/login?link=1">{t("account.sso.link")}</a>
              </Button>
            </div>
          </SettingsSection>
        ) : null}
      </PageBody>
    </>
  );
}

import { redirect } from "next/navigation";
import { AuthCard } from "@/components/AuthCard";
import { AuthForm } from "@/components/AuthForm";
import { SsoButton } from "@/components/SsoButton";
import { api } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";
import type { AuthConfig } from "@/lib/types";

export const metadata = { title: t("auth.signIn") };

const SSO_ERRORS: Record<string, MessageKey> = {
  invalid_state: "auth.error.invalid_state",
  invalid_issuer: "auth.error.invalid_issuer",
  provider_unavailable: "auth.error.provider_unavailable",
  exchange_failed: "auth.error.exchange_failed",
  no_account: "auth.error.no_account",
  email_in_use: "auth.error.email_in_use",
  no_admin: "auth.error.no_admin",
  no_email: "auth.error.no_email",
  rate_limited: "auth.error.rate_limited",
};

/** The API redirects here with `?error=<code>` when a Kore ID sign-in fails. */
function ssoError(raw: string | string[] | undefined): string | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;
  return t(SSO_ERRORS[code] ?? "auth.error.generic");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const config = await api<AuthConfig>("/api/auth/config");
  // A brand-new install has no account yet: send people to create one (with a password).
  if (config.password_login) {
    const status = await api<{ setup_required: boolean }>("/api/setup");
    if (status.setup_required) {
      redirect(`/setup?next=${encodeURIComponent(next)}`);
    }
  }
  const sso = config.oidc;
  return (
    <AuthCard title={t("auth.signIn")}>
      <div className="flex flex-col gap-4">
        {sso ? <SsoButton name={sso.name} loginUrl={sso.login_url} next={next} /> : null}
        {sso && config.password_login ? <p className="text-center text-sub text-muted">{t("auth.or")}</p> : null}
        {config.password_login ? (
          <AuthForm mode="login" next={next} expired={"expired" in sp} error={ssoError(sp.error)} />
        ) : (
          <>
            {ssoError(sp.error) ? (
              <p role="alert" className="text-sub text-danger">
                {ssoError(sp.error)}
              </p>
            ) : null}
            {!sso ? <p className="text-sub text-muted">{t("auth.passwordsOff")}</p> : null}
          </>
        )}
      </div>
    </AuthCard>
  );
}

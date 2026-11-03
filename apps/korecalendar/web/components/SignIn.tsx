"use client";

import { AuthScreen } from "@qarasky/kore-ui";
import { t } from "@/lib/i18n";
import type { AuthConfig } from "@/lib/types";

/**
 * Sign-in: kore-ui's AuthScreen with "Continue with Kore ID" only (a plain link
 * to the API's OIDC start route, so the redirect dance stays server-side).
 * There is no password form: when no provider is configured, the page says so.
 */
export function SignIn({ config, next, expired, initialError }: { config: AuthConfig; next: string; expired: boolean; initialError: string | null }) {
  const sso = config.oidc;
  return (
    <AuthScreen
      app="korecalendar"
      title={t("auth.signIn")}
      notice={expired ? t("auth.expired") : null}
      error={initialError}
      sso={sso ? { href: `${sso.login_url}?next=${encodeURIComponent(next)}`, label: t("auth.ssoSignIn", { name: sso.name }) } : undefined}
    >
      {!sso ? <p className="text-sub text-muted">{t("auth.noMethod")}</p> : null}
    </AuthScreen>
  );
}

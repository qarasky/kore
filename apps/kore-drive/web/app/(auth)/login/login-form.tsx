"use client";

import { AuthScreen } from "@qarasky/kore-ui";
import type { ReactNode } from "react";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * The sign-in screen (kore-ui AuthScreen). Kore ID is the only way in: the
 * screen offers "Continue with Kore ID" (or explains that the server has no
 * identity provider configured) and the login picture on the right from 900px.
 */
export function LoginScreen({
  expired,
  ssoHref,
  ssoError,
  aside,
}: {
  expired: boolean;
  /** The OIDC start route, when Kore ID is on. */
  ssoHref?: string;
  ssoError?: MessageKey | null;
  aside: ReactNode;
}) {
  return (
    <AuthScreen
      app="kore"
      title={t("login.title")}
      description={t("login.sso.subtitle")}
      error={ssoError ? <span data-testid="login-sso-error">{t(ssoError)}</span> : null}
      notice={
        expired ? (
          <span data-testid="login-error">{t("login.expired")}</span>
        ) : !ssoHref ? (
          <span data-testid="login-sso-missing">{t("login.sso.notConfigured")}</span>
        ) : null
      }
      sso={ssoHref ? { href: ssoHref, label: t("login.sso") } : undefined}
      aside={aside}
    />
  );
}

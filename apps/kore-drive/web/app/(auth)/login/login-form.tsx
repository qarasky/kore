"use client";

import { AuthScreen } from "@qarasky/kore-ui";
import { useState, type ReactNode } from "react";
import { api, isApiError } from "@/lib/api";
import { t, type MessageKey } from "@/lib/i18n";

function errorKey(e: unknown): MessageKey {
  if (isApiError(e, 401)) return "login.error.invalid";
  if (isApiError(e, 429)) return "login.error.rateLimited";
  if (isApiError(e, 503) && e.code === "busy") return "login.error.busy";
  // 503 from api() itself; 502/504 from Caddy or the dev rewrite when the API is down.
  if (isApiError(e) && [502, 503, 504].includes(e.status)) return "login.error.unreachable";
  return "login.error.generic";
}

/**
 * The sign-in screen (kore-ui AuthScreen): "Continue with Kore ID" first and
 * primary when Kore ID is on, the email + password form when local login is
 * on, and the login picture on the right from 900px.
 */
export function LoginScreen({
  next,
  expired,
  localLogin,
  ssoHref,
  ssoError,
  aside,
}: {
  next: string;
  expired: boolean;
  localLogin: boolean;
  /** The OIDC start route, when Kore ID is on. */
  ssoHref?: string;
  ssoError?: MessageKey | null;
  aside: ReactNode;
}) {
  const [error, setError] = useState<MessageKey | null>(null);

  async function signIn({ email, password }: { email: string; password: string }) {
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    } catch (err) {
      setError(errorKey(err));
      throw err; // keeps the form on screen
    }
    // Full navigation so the destination renders on the server with the new cookie.
    window.location.assign(next);
    // Stay "Signing in…" until the page is replaced.
    await new Promise(() => {});
  }

  const shownError = error ?? ssoError ?? null;
  return (
    <AuthScreen
      app="kore"
      title={t("login.title")}
      description={t(localLogin ? "login.subtitle" : "login.sso.subtitle")}
      dividerLabel={t("login.sso.or")}
      error={
        shownError ? (
          <span data-testid={error ? "login-error" : "login-sso-error"}>{t(shownError)}</span>
        ) : null
      }
      notice={expired ? <span data-testid="login-error">{t("login.expired")}</span> : null}
      sso={ssoHref ? { href: ssoHref, label: t("login.sso") } : undefined}
      password={
        localLogin
          ? {
              onSubmit: signIn,
              invalid: error === "login.error.invalid",
              labels: {
                email: t("login.email"),
                password: t("login.password"),
                submit: t("login.submit"),
                pending: t("login.submitting"),
              },
            }
          : undefined
      }
      aside={aside}
    />
  );
}

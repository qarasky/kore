"use client";

import { AuthScreen, Button, Field, Input } from "@qarasky/kore-ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, isApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { t } from "@/lib/i18n";
import type { AuthConfig } from "@/lib/types";

/**
 * Sign-in: kore-ui's AuthScreen. "Continue with Kore ID" (a plain link to the API's OIDC start
 * route, so the redirect dance stays server-side) comes first and is primary; the email +
 * password form follows while password sign-in is on.
 */
export function SignIn({ config, next, expired, initialError }: { config: AuthConfig; next: string; expired: boolean; initialError: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError);
  const [invalid, setInvalid] = useState(false);
  const sso = config.oidc;

  async function onSubmit(values: { email: string; password: string }) {
    setError(null);
    setInvalid(false);
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify(values) });
    } catch (e) {
      setError(errorMessage(e));
      setInvalid(isApiError(e, 401));
      throw e;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <AuthScreen
      app="korecalendar"
      title={t("auth.signIn")}
      notice={expired ? t("auth.expired") : null}
      error={error}
      dividerLabel={t("auth.or")}
      sso={sso ? { href: `${sso.login_url}?next=${encodeURIComponent(next)}`, label: t("auth.ssoSignIn", { name: sso.name }) } : undefined}
      password={
        config.password_login
          ? {
              onSubmit,
              invalid,
              labels: { email: t("auth.email"), password: t("auth.password"), submit: t("auth.signIn"), pending: t("auth.signingIn") },
            }
          : undefined
      }
    >
      {!sso && !config.password_login ? <p className="text-sub text-muted">{t("auth.passwordsOff")}</p> : null}
    </AuthScreen>
  );
}

/** First run: create the administrator account (email + password) on kore-ui's AuthScreen. */
export function SetupAccount({ next }: { next: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/setup", { method: "POST", body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthScreen app="korecalendar" title={t("auth.createAccount")} description={t("auth.setupIntro")} error={error}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("auth.email")}>
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </Field>
        <Field label={t("auth.password")} hint={t("auth.passwordHint")}>
          <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </Field>
        <Button type="submit" variant="primary" fullWidth loading={busy}>
          {busy ? t("auth.creating") : t("auth.createAccount")}
        </Button>
      </form>
    </AuthScreen>
  );
}

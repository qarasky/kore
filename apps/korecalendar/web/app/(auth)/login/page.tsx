import { SignIn } from "@/components/SignIn";
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

/** Kore ID is the only sign-in method. A fresh install's first admin comes
 *  from KORECAL_OIDC_OWNER_EMAIL on the first Kore ID sign-in. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const config = await api<AuthConfig>("/api/auth/config");
  return <SignIn config={config} next={next} expired={"expired" in sp} initialError={ssoError(sp.error)} />;
}

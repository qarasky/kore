import type { Metadata } from "next";
import { LoginArt } from "@/components/LoginArt";
import { api } from "@/lib/api";
import { getAuthConfig } from "@/lib/authConfig";
import { loginImageSrc, type Branding } from "@/lib/branding";
import { t } from "@/lib/i18n";
import { safeNext } from "@/lib/safe-next";
import { loginSsoError } from "@/lib/ssoErrors";
import { LoginScreen } from "./login-form";

export const metadata: Metadata = { title: t("login.title") };

/** The login picture setting; any failure falls back to the built-in art
 *  (the form must work even when this lookup doesn't). */
async function branding(): Promise<Branding | null> {
  try {
    return await api<Branding>("/api/branding", { signal: AbortSignal.timeout(3000) });
  } catch {
    return null;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const expired = params.expired !== undefined;
  const custom = loginImageSrc(await branding());
  const auth = await getAuthConfig();
  const ssoError = loginSsoError(params.error);
  const ssoHref = `/api/auth/oidc/login?next=${encodeURIComponent(next)}`;

  return (
    <LoginScreen
      next={next}
      expired={expired}
      localLogin={auth.local_login}
      ssoHref={auth.oidc ? ssoHref : undefined}
      ssoError={auth.oidc ? ssoError : null}
      aside={
        <div data-testid="login-picture" className="absolute inset-0 bg-[#111522]">
          {custom ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API, not next/image
            <img src={custom} alt="" data-testid="login-picture-custom" className="absolute inset-0 size-full object-cover" />
          ) : (
            <LoginArt className="absolute inset-0 size-full" />
          )}
        </div>
      }
    />
  );
}

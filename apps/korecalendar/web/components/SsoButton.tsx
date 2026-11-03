import { t } from "@/lib/i18n";

/** "Sign in with Kore ID": a plain link, so the whole OpenID Connect redirect
 *  dance (PKCE, state, nonce) stays on the API and no secret reaches the browser. */
export function SsoButton({ name, loginUrl, next }: { name: string; loginUrl: string; next: string }) {
  return (
    <a
      href={`${loginUrl}?next=${encodeURIComponent(next)}`}
      className="flex min-h-control items-center justify-center rounded-ui bg-accent px-4 font-medium text-white transition-colors hover:bg-accent-hover"
    >
      {t("auth.ssoSignIn", { name })}
    </a>
  );
}

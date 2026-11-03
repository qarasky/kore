import { readFileSync } from "node:fs";

export type OidcConfig = {
  /** Base URL of Kore ID (the `iss` claim). Discovery is read from `<issuer>/.well-known/openid-configuration`. */
  issuer: string;
  clientId: string;
  /** Empty for a public client (PKCE only). */
  clientSecret: string;
  scopes: string;
  /** Where Kore ID sends the browser back: this backend's `/auth/callback`. Must be registered for the client. */
  redirectUri: string;
  /** Create a local account for any Kore ID user who signs in. Off by default: only the first user (the owner) and the allow-list can. */
  autoProvision: boolean;
  /** Emails (`a@b.c`) or domains (`@b.c`) that may sign in and be provisioned. Empty = no restriction beyond `autoProvision`. */
  allowedEmails: string[];
  /** Link a Kore ID login to an existing local account with the same email. Unsafe unless Kore ID verifies emails or is closed to the public. */
  trustEmailLink: boolean;
  /** Origins the web UI may return to after sign-in (open-redirect guard). Empty = loopback origins only. */
  webOrigins: string[];
};

export type Config = {
  port: number;
  dataDir: string;
  host: "0.0.0.0";
  /** Email + password sign-in and registration. On unless KOREMIND_PASSWORD_LOGIN=0 (only honoured when Kore ID is configured). */
  passwordLogin: boolean;
  /** Null when Kore ID is not configured (KOREMIND_OIDC_ISSUER unset). */
  oidc: OidcConfig | null;
};

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const flag = (v: string | undefined, dflt: boolean) => (v === undefined || v === "" ? dflt : /^(1|true|yes|on)$/i.test(v.trim()));

export function loadConfig(env: Record<string, string | undefined>, readFile: (p: string) => string = (p) => readFileSync(p, "utf8")): Config {
  const port = Number(env.KOREMIND_PORT ?? 8787);
  const issuer = (env.KOREMIND_OIDC_ISSUER ?? "").trim().replace(/\/+$/, "");
  let oidc: OidcConfig | null = null;
  if (issuer) {
    if (!/^https?:\/\//.test(issuer)) throw new Error("KOREMIND_OIDC_ISSUER must be an http(s) URL");
    const secretFile = env.KOREMIND_OIDC_CLIENT_SECRET_FILE?.trim();
    const publicUrl = (env.KOREMIND_PUBLIC_URL ?? `http://localhost:${port}`).trim().replace(/\/+$/, "");
    oidc = {
      issuer,
      clientId: env.KOREMIND_OIDC_CLIENT_ID?.trim() || "koremind",
      clientSecret: (secretFile ? readFile(secretFile) : env.KOREMIND_OIDC_CLIENT_SECRET ?? "").trim(),
      scopes: env.KOREMIND_OIDC_SCOPES?.trim() || "openid profile email",
      redirectUri: env.KOREMIND_OIDC_REDIRECT_URI?.trim() || `${publicUrl}/auth/callback`,
      autoProvision: flag(env.KOREMIND_OIDC_AUTO_PROVISION, false),
      allowedEmails: list(env.KOREMIND_OIDC_ALLOWED_EMAILS),
      trustEmailLink: flag(env.KOREMIND_OIDC_TRUST_EMAIL_LINK, false),
      webOrigins: (env.KOREMIND_WEB_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
    };
  }
  // Turning password login off without a working alternative would lock everyone out, so it needs Kore ID.
  const passwordLogin = oidc ? flag(env.KOREMIND_PASSWORD_LOGIN, true) : true;
  return { port, dataDir: env.KOREMIND_DATA_DIR ?? "./data", host: "0.0.0.0", passwordLogin, oidc };
}

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
  /**
   * Create a local account for anyone Kore ID lets into this app. On by default: Kore ID accounts are admin-made and access to
   * KoreMind is granted per user there. Off: only the first user (the owner) and the allow-list get an account.
   */
  autoProvision: boolean;
  /** Optional extra filter: emails (`a@b.c`) or domains (`@b.c`) that may get an account. Empty = whoever Kore ID lets in. */
  allowedEmails: string[];
  /** Link a first Kore ID sign-in to the existing local account with the same email, when Kore ID says `email_verified: true`. On by default. */
  emailLink: boolean;
  /**
   * Pins who becomes the owner of an empty KoreMind: only a Kore ID sign-in with this (verified) email can create the first
   * account. Empty = the first Kore ID account is the owner.
   */
  ownerEmail: string;
  /** This backend's back-channel logout endpoint, to register in Kore ID as the client's `backchannelLogoutUri`. */
  backchannelLogoutUri: string;
  /** Origins the web UI may return to after sign-in (open-redirect guard). Empty = loopback origins only. */
  webOrigins: string[];
};

export type Config = {
  port: number;
  dataDir: string;
  host: "0.0.0.0";
  /** This is the only way in. Null when Kore ID is not configured (KOREMIND_OIDC_ISSUER unset); the server then refuses every sign-in. */
  oidc: OidcConfig | null;
  /** Other Kore apps for the web UI's app switcher, from KOREMIND_KORE_APPS (`kore=https://…,korecalendar=https://…`). */
  apps: Partial<Record<"kore" | "koremind" | "korecalendar" | "flatline", string>>;
};

export const BACKCHANNEL_LOGOUT_PATH = "/auth/backchannel-logout";
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
      autoProvision: flag(env.KOREMIND_OIDC_AUTO_PROVISION, true),
      allowedEmails: list(env.KOREMIND_OIDC_ALLOWED_EMAILS),
      // KOREMIND_OIDC_TRUST_EMAIL_LINK is the old name (it used to link without email_verified); it still turns the feature on/off.
      emailLink: flag(env.KOREMIND_OIDC_EMAIL_LINK ?? env.KOREMIND_OIDC_TRUST_EMAIL_LINK, true),
      ownerEmail: (env.KOREMIND_OIDC_OWNER_EMAIL ?? "").trim().toLowerCase(),
      backchannelLogoutUri: `${publicUrl}${BACKCHANNEL_LOGOUT_PATH}`,
      webOrigins: (env.KOREMIND_WEB_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean),
    };
  }
  // There is no password fallback: Kore ID is the only human sign-in. The owner is pinned by KOREMIND_OIDC_OWNER_EMAIL
  // (or is the first Kore ID account); everyone else is auto-provisioned.
  const apps: Config["apps"] = {};
  for (const pair of (env.KOREMIND_KORE_APPS ?? "").split(",")) {
    const [k, ...rest] = pair.split("=");
    const key = k?.trim().toLowerCase(), url = rest.join("=").trim();
    if (!key || !url) continue;
    if (!["kore", "koremind", "korecalendar", "flatline"].includes(key)) throw new Error(`KOREMIND_KORE_APPS: unknown app "${key}" (kore, koremind, korecalendar, flatline)`);
    if (!/^https?:\/\//.test(url)) throw new Error(`KOREMIND_KORE_APPS: ${key} needs an http(s) URL`);
    apps[key as keyof Config["apps"]] = url;
  }
  return { port, dataDir: env.KOREMIND_DATA_DIR ?? "./data", host: "0.0.0.0", oidc, apps };
}

import type { Database } from "bun:sqlite";
import type { AuthResponse, SsoStart, User } from "@koremind/shared";
import { AuthError, toUser, type Auth } from "./auth";
import type { OidcConfig } from "./config";
import { OidcError, randomB64url, s256, type Identity, type Oidc } from "./oidc";

const FLOW_TTL_MS = 10 * 60 * 1000;
const TICKET_TTL_MS = 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const START_MAX = 30;
const EXCHANGE_MAX = 20;

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

/** Why a Kore ID sign-in was refused; sent to the client as `sso_error=<code>`. */
export type SsoErrorCode =
  | "denied" | "invalid_state" | "provider_error" | "no_email" | "not_allowed" | "account_exists" | "sub_taken" | "already_linked" | "unavailable";

export class SsoError extends Error {
  constructor(public code: SsoErrorCode, message: string) { super(message); }
}

export type CallbackResult =
  | { kind: "web"; returnTo: string; ticket?: string; linked?: boolean }
  | { kind: "android"; ticket?: string; linked?: boolean };

const emailAllowed = (list: string[], email: string) => list.some((a) => (a.startsWith("@") ? email.endsWith(a) : email === a));

/**
 * Kore ID sign-in on top of the local session mechanism.
 *
 * The backend is the OIDC client (confidential, PKCE S256): the browser or phone only ever sees a one-time ticket, which it can
 * redeem only with the PKCE verifier it generated itself, so a ticket that leaks through a URL or a custom-scheme link is useless.
 */
export function createSso(db: Database, auth: Auth, oidc: Oidc, cfg: OidcConfig, now: () => number = Date.now) {
  const throttle = (key: string, max: number) => {
    const t = now();
    db.run("delete from login_attempts where window_start < ?", [t - WINDOW_MS]);
    const row = db.query("select count, window_start from login_attempts where key=?").get(key) as { count: number; window_start: number } | null;
    if (row && row.count >= max) throw new AuthError("rate_limited", "Too many attempts", Math.ceil((row.window_start + WINDOW_MS - t) / 1000));
    db.run("insert or replace into login_attempts(key,count,window_start) values(?,?,?)", [key, (row?.count ?? 0) + 1, row?.window_start ?? t]);
  };

  const originAllowed = (origin: string) => {
    if (cfg.webOrigins.length) return cfg.webOrigins.includes(origin);
    try { const h = new URL(origin).hostname; return h === "localhost" || h === "127.0.0.1" || h === "[::1]"; } catch { return false; }
  };

  /** Finds or creates the local account for a verified Kore ID identity. */
  function resolve(id: Identity): User {
    const bySub = db.query("select * from users where oidc_sub=?").get(id.sub) as Parameters<typeof toUser>[0] | null;
    if (bySub) return toUser(bySub);
    if (!id.email) throw new SsoError("no_email", "Kore ID did not share an email address");
    if (id.emailVerified === false) throw new SsoError("no_email", "The email address is not verified");

    const sameEmail = db.query("select * from users where email=?").get(id.email) as (Parameters<typeof toUser>[0]) | null;
    if (sameEmail) {
      // Kore ID does not verify emails (yet), so a matching email proves nothing. Linking is opt-in, or done by the signed-in owner.
      if (!cfg.trustEmailLink || sameEmail.oidc_sub) throw new SsoError("account_exists", "An account with this email already exists");
      db.run("update users set oidc_sub=? where id=? and oidc_sub is null", [id.sub, sameEmail.id]);
      return toUser({ ...sameEmail, oidc_sub: id.sub });
    }

    const first = (db.query("select count(*) c from users").get() as { c: number }).c === 0;
    const listed = cfg.allowedEmails.length > 0 && emailAllowed(cfg.allowedEmails, id.email);
    const allowed = cfg.allowedEmails.length ? listed : first || cfg.autoProvision;
    if (!allowed) throw new SsoError("not_allowed", "This KoreMind does not accept new accounts");
    const user: User = { id: crypto.randomUUID(), email: id.email, isOwner: first, ssoLinked: true };
    db.run("insert into users(id,email,password_hash,is_owner,created_at,oidc_sub) values(?,?,?,?,?,?)", [user.id, user.email, "", first ? 1 : 0, now(), id.sub]);
    return user;
  }

  return {
    /** Begins a sign-in (or, with `caller`, linking Kore ID to the signed-in account). Returns the Kore ID URL to open. */
    async start(req: SsoStart, ip: string, caller?: User): Promise<string> {
      throttle(`sso-start|${ip}`, START_MAX);
      let returnTo: string | null = null;
      if (req.platform === "web") {
        if (!req.returnTo) throw new AuthError("sso_failed", "returnTo is required for web");
        const u = new URL(req.returnTo);
        if (!originAllowed(u.origin)) throw new AuthError("sso_failed", `${u.origin} is not an allowed web origin (KOREMIND_WEB_ORIGINS)`);
        returnTo = u.origin + u.pathname;
      }
      const state = randomB64url(24), nonce = randomB64url(24), verifier = randomB64url(48);
      db.run("delete from oidc_flows where expires_at < ?", [now()]);
      db.run("insert into oidc_flows(state_hash,nonce,verifier,app_challenge,platform,return_to,link_user_id,expires_at) values(?,?,?,?,?,?,?,?)", [
        sha256(state), nonce, verifier, req.challenge, req.platform, returnTo, caller?.id ?? null, now() + FLOW_TTL_MS,
      ]);
      try { return await oidc.authorizationUrl({ state, nonce, verifier }); }
      catch (e) { throw new AuthError("sso_failed", e instanceof OidcError ? e.message : "Kore ID is unavailable"); }
    },

    /** Handles Kore ID's redirect to /auth/callback. Never throws for protocol errors: they become part of the result. */
    async callback(q: { code?: string; state?: string; error?: string }): Promise<CallbackResult & { error?: SsoErrorCode }> {
      const flow = q.state
        ? (db.query("select * from oidc_flows where state_hash=? and expires_at>?").get(sha256(q.state), now()) as
            | { nonce: string; verifier: string; app_challenge: string; platform: "web" | "android"; return_to: string | null; link_user_id: string | null } | null)
        : null;
      if (q.state) db.run("delete from oidc_flows where state_hash=?", [sha256(q.state)]); // single use
      if (!flow) return { kind: "web", returnTo: "", error: "invalid_state" };
      const back = (extra: { ticket?: string; linked?: boolean; error?: SsoErrorCode }): CallbackResult & { error?: SsoErrorCode } =>
        flow.platform === "web" ? { kind: "web", returnTo: flow.return_to ?? "", ...extra } : { kind: "android", ...extra };

      if (q.error) return back({ error: q.error === "access_denied" ? "denied" : "provider_error" });
      if (!q.code) return back({ error: "provider_error" });
      let identity: Identity;
      try { identity = await oidc.exchangeCode({ code: q.code, verifier: flow.verifier, nonce: flow.nonce }); }
      catch (e) { console.error("sso:", e instanceof Error ? e.message : e); return back({ error: e instanceof OidcError && e.code === "discovery" ? "unavailable" : "provider_error" }); }

      try {
        if (flow.link_user_id) {
          const mine = db.query("select oidc_sub from users where id=?").get(flow.link_user_id) as { oidc_sub: string | null } | null;
          if (!mine) return back({ error: "provider_error" });
          if (mine.oidc_sub && mine.oidc_sub !== identity.sub) return back({ error: "already_linked" });
          const taken = db.query("select id from users where oidc_sub=? and id<>?").get(identity.sub, flow.link_user_id);
          if (taken) return back({ error: "sub_taken" });
          db.run("update users set oidc_sub=? where id=?", [identity.sub, flow.link_user_id]);
          return back({ linked: true });
        }
        const user = resolve(identity);
        const ticket = randomB64url(32);
        const end = await oidc.logoutUrl(identity.idToken, flow.return_to ? new URL("/login", flow.return_to).toString() : undefined);
        db.run("insert into oidc_tickets(ticket_hash,user_id,app_challenge,logout_url,expires_at) values(?,?,?,?,?)", [sha256(ticket), user.id, flow.app_challenge, end, now() + TICKET_TTL_MS]);
        return back({ ticket });
      } catch (e) {
        if (e instanceof SsoError) return back({ error: e.code });
        throw e;
      }
    },

    /** Trades the one-time ticket plus the client's PKCE verifier for a normal KoreMind session. */
    async exchange(ticket: string, verifier: string, ip: string): Promise<AuthResponse> {
      throttle(`sso-exchange|${ip}`, EXCHANGE_MAX);
      db.run("delete from oidc_tickets where expires_at < ?", [now()]);
      const row = db.query("select * from oidc_tickets where ticket_hash=?").get(sha256(ticket)) as
        | { user_id: string; app_challenge: string; logout_url: string | null } | null;
      if (!row) throw new AuthError("bad_code", "That sign-in has expired. Try again");
      db.run("delete from oidc_tickets where ticket_hash=?", [sha256(ticket)]); // single use, even when the verifier is wrong
      if ((await s256(verifier)) !== row.app_challenge) throw new AuthError("bad_code", "That sign-in has expired. Try again");
      return auth.issueFor(row.user_id, row.logout_url);
    },

    /** The local user for a Kore ID access token used as an API bearer (no auto-provisioning here). */
    async verifyBearer(token: string): Promise<User | null> {
      const v = await oidc.verifyAccessToken(token);
      return v ? auth.userBySub(v.sub) : null;
    },
  };
}
export type Sso = ReturnType<typeof createSso>;

import type { Database } from "bun:sqlite";
import type { AuthResponse, User } from "@koremind/shared";

export class AuthError extends Error {
  constructor(
    public code: "rate_limited" | "bad_code" | "sso_failed",
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const PAIR_TTL_MS = 2 * 60 * 1000;
const PAIR_MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

// password_hash is a legacy column from before Kore ID-only sign-in. It stays in the schema because dropping it would rewrite
// every existing database, but it is never read or checked again. New rows store an empty placeholder to satisfy NOT NULL.
type UserRow = { id: string; email: string; is_owner: number; oidc_sub?: string | null };
export const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, isOwner: !!r.is_owner, ...(r.oidc_sub ? { ssoLinked: true } : {}) });

/** Where a session came from: `sid` is the Kore ID session it belongs to, `logoutUrl` ends that session (RP-initiated logout). */
type Origin = { sid?: string | null; logoutUrl?: string | null };

export function createAuth(db: Database, now: () => number = Date.now) {
  const issue = (user: User, o: Origin = {}): AuthResponse => {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    db.run("insert into tokens(token_hash,user_id,expires_at,logout_url,sid) values(?,?,?,?,?)", [sha256(token), user.id, now() + TOKEN_TTL_MS, o.logoutUrl ?? null, o.sid ?? null]);
    return { token, user };
  };
  const setupRequired = () => (db.query("select count(*) c from users").get() as { c: number }).c === 0;

  return {
    setupRequired,
    /**
     * Starts a normal session for an existing user (used by Kore ID sign-in). `sid` ties it to the Kore ID session (back-channel
     * logout ends it); `logoutUrl` is kept to end the Kore ID session on sign-out.
     */
    issueFor(userId: string, origin: Origin = {}): AuthResponse {
      const r = db.query("select * from users where id=?").get(userId) as UserRow | null;
      if (!r) throw new AuthError("sso_failed", "Unknown user");
      return issue(toUser(r), origin);
    },
    /**
     * Back-channel logout: ends every session that came from Kore ID session `sid` (including phones paired from it), or, without
     * a sid, every session of the local user linked to `sub`. Pending sign-in tickets and pairing codes from it go too. Returns
     * how many sessions ended.
     */
    endSessions(q: { sid?: string; sub?: string }): number {
      return db.transaction(() => {
        if (q.sid) {
          db.run("delete from oidc_tickets where sid=?", [q.sid]);
          db.run("delete from pair_codes where sid=?", [q.sid]);
          return db.run("delete from tokens where sid=?", [q.sid]).changes;
        }
        const u = q.sub ? (db.query("select id from users where oidc_sub=?").get(q.sub) as { id: string } | null) : null;
        if (!u) return 0;
        db.run("delete from oidc_tickets where user_id=?", [u.id]);
        db.run("delete from pair_codes where user_id=?", [u.id]);
        return db.run("delete from tokens where user_id=?", [u.id]).changes;
      })();
    },
    /** The local user a Kore ID `sub` is linked to. */
    userBySub(sub: string): User | null {
      const r = db.query("select * from users where oidc_sub=?").get(sub) as UserRow | null;
      return r ? toUser(r) : null;
    },

    /**
     * A short-lived, single-use code a new device can trade for its own session. One live code per user. The new session inherits
     * the Kore ID `sid` of the session that made the code (`fromToken`), so signing out of Kore ID signs the phone out too. It does
     * not inherit the RP-logout URL: signing out on the phone must not end the Kore ID session of the computer's browser.
     * Pairing is Kore ID-backed: the code can only be minted from an already Kore ID-authenticated web session.
     */
    startPair(userId: string, fromToken?: string): { code: string; expiresAt: number } {
      const code = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
      const expiresAt = now() + PAIR_TTL_MS;
      const sid = fromToken ? ((db.query("select sid from tokens where token_hash=?").get(sha256(fromToken)) as { sid: string | null } | null)?.sid ?? null) : null;
      db.transaction(() => {
        db.run("delete from pair_codes where user_id=? or expires_at<?", [userId, now()]);
        db.run("insert into pair_codes(code_hash,user_id,expires_at,sid) values(?,?,?,?)", [sha256(code), userId, expiresAt, sid]);
      })();
      return { code, expiresAt };
    },

    async redeemPair(code: string, ip: string): Promise<AuthResponse> {
      const key = `pair|${ip}`;
      const t = now();
      db.run("delete from login_attempts where window_start < ?", [t - WINDOW_MS]);
      const row = db.query("select count, window_start from login_attempts where key=?").get(key) as { count: number; window_start: number } | null;
      if (row && row.count >= PAIR_MAX_ATTEMPTS) throw new AuthError("rate_limited", "Too many attempts", Math.ceil((row.window_start + WINDOW_MS - t) / 1000));
      const hit = db.query("select user_id, sid from pair_codes where code_hash=? and expires_at>?").get(sha256(code), t) as { user_id: string; sid: string | null } | null;
      if (!hit) {
        db.run("insert or replace into login_attempts(key,count,window_start) values(?,?,?)", [key, (row?.count ?? 0) + 1, row?.window_start ?? t]);
        throw new AuthError("bad_code", "That code isn't valid or has expired");
      }
      db.run("delete from pair_codes where code_hash=?", [sha256(code)]);
      const user = db.query("select * from users where id=?").get(hit.user_id) as UserRow;
      return issue(toUser(user), { sid: hit.sid });
    },

    verify(token: string): User | null {
      const r = db
        .query("select u.* from tokens t join users u on u.id=t.user_id where t.token_hash=? and t.expires_at>?")
        .get(sha256(token), now()) as UserRow | null;
      return r ? toUser(r) : null;
    },

    /** Ends the session. Returns the Kore ID logout URL when the session came from Kore ID. */
    logout(token: string): string | null {
      const row = db.query("select logout_url from tokens where token_hash=?").get(sha256(token)) as { logout_url: string | null } | null;
      db.run("delete from tokens where token_hash=?", [sha256(token)]);
      return row?.logout_url ?? null;
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;

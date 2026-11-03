import type { Database } from "bun:sqlite";
import type { AuthRequest, AuthResponse, User } from "@koremind/shared";

export class AuthError extends Error {
  constructor(
    public code: "setup_closed" | "bad_credentials" | "rate_limited" | "bad_code",
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 5;
const PAIR_TTL_MS = 2 * 60 * 1000;
const PAIR_MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");

type UserRow = { id: string; email: string; password_hash: string; is_owner: number };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, isOwner: !!r.is_owner });

export function createAuth(db: Database, now: () => number = Date.now) {
  const issue = (user: User): AuthResponse => {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    db.run("insert into tokens(token_hash,user_id,expires_at) values(?,?,?)", [sha256(token), user.id, now() + TOKEN_TTL_MS]);
    return { token, user };
  };
  const setupRequired = () => (db.query("select count(*) c from users").get() as { c: number }).c === 0;

  return {
    setupRequired,

    async register(req: AuthRequest, caller?: User): Promise<AuthResponse> {
      const first = setupRequired();
      if (!first && !caller?.isOwner) throw new AuthError("setup_closed", "Registration is closed");
      const user: User = { id: crypto.randomUUID(), email: req.email.toLowerCase(), isOwner: first };
      db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,?,?)", [
        user.id, user.email, await Bun.password.hash(req.password), first ? 1 : 0, now(),
      ]);
      return issue(user);
    },

    async login(req: AuthRequest, ip: string): Promise<AuthResponse> {
      const email = req.email.toLowerCase();
      const key = `${ip}|${email}`;
      const t = now();
      db.run("delete from login_attempts where window_start < ?", [t - WINDOW_MS]);
      const row = db.query("select count, window_start from login_attempts where key=?").get(key) as
        | { count: number; window_start: number } | null;
      const active = row && t - row.window_start < WINDOW_MS ? row : null;
      if (active && active.count >= MAX_ATTEMPTS) {
        throw new AuthError("rate_limited", "Too many attempts", Math.ceil((active.window_start + WINDOW_MS - t) / 1000));
      }
      const user = db.query("select * from users where email=?").get(email) as UserRow | null;
      const ok = user ? await Bun.password.verify(req.password, user.password_hash) : false;
      if (!ok || !user) {
        db.run("insert or replace into login_attempts(key,count,window_start) values(?,?,?)", [
          key, (active?.count ?? 0) + 1, active?.window_start ?? t,
        ]);
        throw new AuthError("bad_credentials", "Wrong email or password");
      }
      db.run("delete from login_attempts where key=?", [key]);
      return issue(toUser(user));
    },

    /** A short-lived, single-use code a new device can trade for its own session. One live code per user. */
    startPair(userId: string): { code: string; expiresAt: number } {
      const code = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
      const expiresAt = now() + PAIR_TTL_MS;
      db.transaction(() => {
        db.run("delete from pair_codes where user_id=? or expires_at<?", [userId, now()]);
        db.run("insert into pair_codes(code_hash,user_id,expires_at) values(?,?,?)", [sha256(code), userId, expiresAt]);
      })();
      return { code, expiresAt };
    },

    async redeemPair(code: string, ip: string): Promise<AuthResponse> {
      const key = `pair|${ip}`;
      const t = now();
      db.run("delete from login_attempts where window_start < ?", [t - WINDOW_MS]);
      const row = db.query("select count, window_start from login_attempts where key=?").get(key) as { count: number; window_start: number } | null;
      if (row && row.count >= PAIR_MAX_ATTEMPTS) throw new AuthError("rate_limited", "Too many attempts", Math.ceil((row.window_start + WINDOW_MS - t) / 1000));
      const hit = db.query("select user_id from pair_codes where code_hash=? and expires_at>?").get(sha256(code), t) as { user_id: string } | null;
      if (!hit) {
        db.run("insert or replace into login_attempts(key,count,window_start) values(?,?,?)", [key, (row?.count ?? 0) + 1, row?.window_start ?? t]);
        throw new AuthError("bad_code", "That code isn't valid or has expired");
      }
      db.run("delete from pair_codes where code_hash=?", [sha256(code)]);
      const user = db.query("select * from users where id=?").get(hit.user_id) as UserRow;
      return issue(toUser(user));
    },

    verify(token: string): User | null {
      const r = db
        .query("select u.* from tokens t join users u on u.id=t.user_id where t.token_hash=? and t.expires_at>?")
        .get(sha256(token), now()) as UserRow | null;
      return r ? toUser(r) : null;
    },

    logout(token: string) {
      db.run("delete from tokens where token_hash=?", [sha256(token)]);
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;

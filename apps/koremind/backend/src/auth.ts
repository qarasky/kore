import type { Database } from "bun:sqlite";
import type { AuthRequest, AuthResponse, User } from "@zero/shared";

export class AuthError extends Error {
  constructor(
    public code: "setup_closed" | "bad_credentials" | "rate_limited",
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_ATTEMPTS = 5;
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

import { randomBytes, createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR, EXTERNAL, OWNER } from "./env";

/**
 * E2E sign-in without a browser round-trip to Kore ID: insert the account and a
 * session token straight into the API's SQLite database (the harness owns it),
 * then set the session cookie. The Kore ID flow itself is covered by the Go
 * tests with a fake provider; the specs here need a signed-in browser.
 */
export type SeededUser = { id: string; email: string; token: string };

const now = () => Math.floor(Date.now() / 1000);

function open(): DatabaseSync {
  if (EXTERNAL) {
    throw new Error("SSO-only e2e cannot seed an external stack's database; unset E2E_BASE_URL");
  }
  return new DatabaseSync(join(DATA_DIR, "korecal.db"));
}

/** The user with `email`, created (with a default calendar) if missing. */
export function seedUser(email = OWNER.email, role: "admin" | "user" = "admin", oidcSub: string | null = null): SeededUser {
  const db = open();
  try {
    const sub = oidcSub ?? `e2e:${email}`;
    const found = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
    let id = found?.id;
    if (!id) {
      id = randomBytes(16).toString("hex");
      db.prepare("INSERT INTO users(id,email,pw_hash,role,timezone,created_at,oidc_sub) VALUES(?,?,?,?,?,?,?)").run(
        id,
        email,
        "!",
        role,
        "UTC",
        now(),
        sub,
      );
    }
    const cal = db.prepare("SELECT count(*) AS n FROM calendars WHERE user_id = ?").get(id) as { n: number };
    if (!cal.n) {
      db.prepare("INSERT INTO calendars(id,user_id,name,color,created_at) VALUES(?,?,?,?,?)").run(
        randomBytes(16).toString("hex"),
        id,
        "Personal",
        "#5b8def",
        now(),
      );
    }
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,id_token,oidc_sid) VALUES(?,?,?,?,?)").run(hash, id, now() + 24 * 3600, "", "");
    return { id, email, token };
  } finally {
    db.close();
  }
}

/** A session token for `email`, seeding the account if needed. */
export function seedSession(email = OWNER.email): string {
  return seedUser(email).token;
}

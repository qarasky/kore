/**
 * Direct access to the throwaway e2e API's SQLite file.
 *
 * Kore ID is the only way to sign in, so the browser tests cannot create an
 * account or a session through the API. They seed both here instead: a user
 * row (no password) and a `sessions` row whose token becomes the
 * `kore_session` cookie. The API hashes the raw token with SHA-256, so the
 * hash is written, never the raw token.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { E2E } from "./env.ts";

export const DEFAULT_QUOTA = 50 * 1024 ** 3;

type Row = { id: string; email: string; role: string; quota_bytes: number };

function db(): DatabaseSync {
  if (!E2E.dbPath) throw new Error("direct database seeding is unavailable with E2E_BASE_URL");
  return new DatabaseSync(E2E.dbPath);
}

/** The local account, created on first use (kw_hash stays empty: legacy). */
export function ensureUser(email: string, role: "admin" | "user" = "user", quotaBytes = DEFAULT_QUOTA): Row {
  const d = db();
  try {
    const found = d.prepare("SELECT id,email,role,quota_bytes FROM users WHERE email=?").get(email) as Row | undefined;
    if (found) return found;
    const id = randomUUID().replaceAll("-", "");
    d.prepare("INSERT INTO users(id,email,pw_hash,role,quota_bytes,created_at) VALUES(?,?,'',?,?,?)").run(
      id,
      email,
      role,
      quotaBytes,
      Math.floor(Date.now() / 1000),
    );
    return { id, email, role, quota_bytes: quotaBytes };
  } finally {
    d.close();
  }
}

/** A fresh session token for an existing (or freshly ensured) account. */
export function sessionToken(email: string, role: "admin" | "user" = email === E2E.admin.email ? "admin" : "user"): string {
  const user = ensureUser(email, role);
  const tok = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(tok).digest("hex");
  const d = db();
  try {
    d.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(
      hash,
      user.id,
      Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    );
  } finally {
    d.close();
  }
  return tok;
}

/** Removes the account and its sessions (for assertions that it is gone). */
export function userExists(email: string): boolean {
  const d = db();
  try {
    return d.prepare("SELECT 1 FROM users WHERE email=?").get(email) !== undefined;
  } finally {
    d.close();
  }
}

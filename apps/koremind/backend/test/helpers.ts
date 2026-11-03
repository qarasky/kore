import type { Database } from "bun:sqlite";
import type { User } from "@koremind/shared";

/**
 * Seeds an account directly. There is no password route: test accounts exist either because Kore ID provisioned them or because
 * they survived from before Kore ID-only sign-in. password_hash keeps its NOT NULL placeholder and is never checked.
 */
export function addUser(db: Database, email: string, o: { owner?: boolean; sub?: string; now?: number } = {}): User {
  const id = crypto.randomUUID();
  db.run("insert into users(id,email,password_hash,is_owner,created_at,oidc_sub) values(?,?,?,?,?,?)", [
    id, email, "", o.owner ? 1 : 0, o.now ?? Date.now(), o.sub ?? null,
  ]);
  return { id, email, isOwner: !!o.owner, ...(o.sub ? { ssoLinked: true } : {}) };
}

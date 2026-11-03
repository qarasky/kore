import { Database } from "bun:sqlite";

const MIGRATIONS: string[] = [
  `
  create table users(id text primary key, email text unique not null, password_hash text not null, is_owner integer not null, created_at integer not null);
  create table tokens(token_hash text primary key, user_id text not null references users(id) on delete cascade, expires_at integer not null);
  create table chats(id text primary key, user_id text not null references users(id) on delete cascade, title text not null, engine_session_id text, model text, updated_at integer not null);
  create index chats_user on chats(user_id, updated_at desc);
  create table messages(id text primary key, chat_id text not null references chats(id) on delete cascade, role text not null, text text not null, sources_json text not null default '[]', created_at integer not null);
  create index messages_chat on messages(chat_id, created_at);
  create table attachments(id text primary key, user_id text not null references users(id) on delete cascade, message_id text references messages(id) on delete set null, name text not null, mime text not null, size integer not null, path text not null);
  create table settings(user_id text primary key references users(id) on delete cascade, json text not null);
  create table favorites(user_id text not null references users(id) on delete cascade, model_key text not null, primary key(user_id, model_key));
  create table login_attempts(key text primary key, count integer not null, window_start integer not null);
  `,
  `
  create table pair_codes(code_hash text primary key, user_id text not null references users(id) on delete cascade, expires_at integer not null);
  create index pair_codes_user on pair_codes(user_id);
  create table notes(id text primary key, user_id text not null references users(id) on delete cascade, chat_id text not null references chats(id) on delete cascade, title text not null, body text not null, created_at integer not null, updated_at integer not null);
  create index notes_chat on notes(chat_id, created_at);
  alter table messages add column activity_json text not null default '[]';
  `,
  // Kore ID single sign-on. users.oidc_sub is the OIDC `sub` (same UUID in every Kore app); the legacy users.password_hash
  // column stays only so old databases need no rewrite, and is never read or written for sign-in again. oidc_flows holds one
  // in-flight login (state -> nonce, PKCE verifier, the client's own PKCE challenge); oidc_tickets is the one-time handover to the client.
  `
  alter table users add column oidc_sub text;
  create unique index users_oidc_sub on users(oidc_sub) where oidc_sub is not null;
  alter table tokens add column logout_url text;
  create table oidc_flows(state_hash text primary key, nonce text not null, verifier text not null, app_challenge text not null, platform text not null, return_to text, link_user_id text references users(id) on delete cascade, expires_at integer not null);
  create table oidc_tickets(ticket_hash text primary key, user_id text not null references users(id) on delete cascade, app_challenge text not null, logout_url text, expires_at integer not null);
  `,
  // Kore ID back-channel logout. tokens.sid is the Kore ID session (`sid` claim) a KoreMind session came from; phones paired
  // from such a session inherit it (pair_codes.sid), so ending the Kore ID session signs both out. oidc_logout_jti remembers
  // logout-token ids until they expire (replay guard; in the DB so it survives restarts).
  `
  alter table tokens add column sid text;
  create index tokens_sid on tokens(sid) where sid is not null;
  alter table oidc_tickets add column sid text;
  alter table pair_codes add column sid text;
  create table oidc_logout_jti(jti text primary key, expires_at integer not null);
  `,
];

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("pragma foreign_keys = on");
  if (path !== ":memory:") db.run("pragma journal_mode = wal");
  db.run("create table if not exists schema_migrations(version integer primary key)");
  const applied = (db.query("select coalesce(max(version),0) v from schema_migrations").get() as { v: number }).v;
  MIGRATIONS.forEach((sql, i) => {
    if (i + 1 <= applied) return;
    db.transaction(() => {
      db.run(sql);
      db.run("insert into schema_migrations(version) values(?)", [i + 1]);
    })();
  });
  return db;
}

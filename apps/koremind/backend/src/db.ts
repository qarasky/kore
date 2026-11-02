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

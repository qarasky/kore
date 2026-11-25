import { expect, test } from "bun:test";
import { openDb } from "../src/db";
import { loadConfig } from "../src/config";

test("migrations are idempotent", () => {
  const db = openDb(":memory:");
  const before = db.query("select count(*) c from sqlite_master where type='table'").get() as { c: number };
  db.close();
  expect(before.c).toBeGreaterThan(5);
});

test("deleting a chat cascades its messages", () => {
  const db = openDb(":memory:");
  db.run("insert into users(id,email,password_hash,is_owner,created_at) values('u','a@b.co','x',1,1)");
  db.run("insert into chats(id,user_id,title,engine_session_id,model,updated_at) values('c','u','t',null,null,1)");
  db.run("insert into messages(id,chat_id,role,text,sources_json,created_at) values('m','c','user','hi','[]',1)");
  db.run("delete from chats where id='c'");
  expect((db.query("select count(*) c from messages").get() as { c: number }).c).toBe(0);
});

test("opening the same file twice runs migrations once", () => {
  const path = `/tmp/koremind-db-${crypto.randomUUID()}.sqlite`;
  openDb(path).close();
  const db = openDb(path);
  expect((db.query("select count(*) c from schema_migrations").get() as { c: number }).c).toBe(5);
});

test("notes belong to a chat and go with it; messages default to no activity", () => {
  const db = openDb(":memory:");
  db.run("insert into users(id,email,password_hash,is_owner,created_at) values('u','a@b.c','h',1,1)");
  db.run("insert into chats(id,user_id,title,engine_session_id,model,updated_at) values('c','u','t',null,null,1)");
  db.run("insert into messages(id,chat_id,role,text,created_at) values('m','c','user','hi',1)");
  expect((db.query("select activity_json a from messages where id='m'").get() as { a: string }).a).toBe("[]");
  db.run("insert into notes(id,user_id,chat_id,title,body,created_at,updated_at) values('n','u','c','T','B',1,1)");
  db.run("delete from chats where id='c'");
  expect((db.query("select count(*) c from notes").get() as { c: number }).c).toBe(0);
});

test("loadConfig defaults", () => {
  expect(loadConfig({})).toEqual({ port: 8787, dataDir: "./data", host: "0.0.0.0", oidc: null, apps: {}, providers: ["claude"], claude: { bin: "claude", configDir: "" } });
  expect(loadConfig({ KOREMIND_PORT: "9000", KOREMIND_DATA_DIR: "/x" })).toEqual({ port: 9000, dataDir: "/x", host: "0.0.0.0", oidc: null, apps: {}, providers: ["claude"], claude: { bin: "claude", configDir: "" } });
  expect(loadConfig({ KOREMIND_PASSWORD_LOGIN: "0" })).not.toHaveProperty("passwordLogin");
  expect(loadConfig({ KOREMIND_KORE_APPS: " kore=https://files.example.com , KoreCalendar=https://cal.example.com/?a=b" }).apps).toEqual({ kore: "https://files.example.com", korecalendar: "https://cal.example.com/?a=b" });
  expect(() => loadConfig({ KOREMIND_KORE_APPS: "nope=https://x.example" })).toThrow();
  expect(() => loadConfig({ KOREMIND_KORE_APPS: "kore=files.example.com" })).toThrow();
});

test("an existing chat becomes one straight branch in its session when the variants migration runs", async () => {
  const { MIGRATIONS } = await import("../src/db");
  const { Database } = await import("bun:sqlite");
  const path = `/tmp/koremind-db-${crypto.randomUUID()}.sqlite`;
  const old = new Database(path, { create: true });
  old.run("create table schema_migrations(version integer primary key)");
  MIGRATIONS.slice(0, 4).forEach((sql, i) => { old.run(sql); old.run("insert into schema_migrations(version) values(?)", [i + 1]); });
  old.run("insert into users(id,email,password_hash,is_owner,created_at) values('u','a@b.c','',1,1)");
  old.run("insert into chats(id,user_id,title,engine_session_id,model,updated_at) values('c','u','t','ses_1',null,1)");
  for (const [id, role, t] of [["m1", "user", 10], ["m2", "assistant", 20], ["m3", "user", 20], ["m4", "assistant", 30]] as const)
    old.run("insert into messages(id,chat_id,role,text,created_at) values(?,?,?,?,?)", [id, "c", role, id, t]);
  old.close();
  const db = openDb(path);
  expect(db.query("select id,parent_id p,session_id s from messages order by created_at,rowid").all()).toEqual([
    { id: "m1", p: null, s: "ses_1" }, { id: "m2", p: "m1", s: "ses_1" }, { id: "m3", p: "m2", s: "ses_1" }, { id: "m4", p: "m3", s: "ses_1" },
  ]);
  expect((db.query("select leaf_id l from chats").get() as { l: string }).l).toBe("m4");
});

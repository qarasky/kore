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
  const path = `/tmp/zero-db-${crypto.randomUUID()}.sqlite`;
  openDb(path).close();
  const db = openDb(path);
  expect((db.query("select count(*) c from schema_migrations").get() as { c: number }).c).toBe(2);
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
  expect(loadConfig({})).toEqual({ port: 8787, dataDir: "./data", host: "0.0.0.0" });
  expect(loadConfig({ ZERO_PORT: "9000", ZERO_DATA_DIR: "/x" })).toEqual({ port: 9000, dataDir: "/x", host: "0.0.0.0" });
});

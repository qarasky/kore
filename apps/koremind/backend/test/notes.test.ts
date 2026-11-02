import { expect, test } from "bun:test";
import type { Activity } from "@zero/shared";
import { openDb } from "../src/db";
import { createNotes } from "../src/notes";

function setup(answer: "allowed" | "denied" | "expired" = "allowed") {
  const db = openDb(":memory:");
  for (const u of ["u1", "u2"]) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,0,1)", [u, `${u}@x.co`, "h"]);
  const chat = (id: string, user: string, title: string) => db.run("insert into chats(id,user_id,title,engine_session_id,model,updated_at) values(?,?,?,null,null,1)", [id, user, title]);
  chat("c1", "u1", "Groceries"); chat("c2", "u1", "Lisbon trip"); chat("c3", "u1", "Lisbon budget"); chat("x1", "u2", "Secret");
  const asked: unknown[] = [];
  const emitted: { chatId: string; a: Activity }[] = [];
  const notes = createNotes(db, {
    ask: async (a) => { asked.push(a); return answer; },
    emit: (chatId, a) => { emitted.push({ chatId, a }); },
  });
  return { db, notes, asked, emitted, ctx: { userId: "u1", chatId: "c1" } };
}

test("save, read and edit notes in the current chat without any approval", async () => {
  const { notes, ctx, asked, emitted } = setup();
  const saved = await notes.save(ctx, { title: "Milk", body: "2 litres" });
  expect(saved.isError).toBeFalsy();
  const id = /note_[0-9a-f]+/.exec(saved.text)![0];
  expect((await notes.read(ctx, {})).text).toContain("2 litres");
  const edited = await notes.edit(ctx, { id, body: "3 litres" });
  expect(edited.isError).toBeFalsy();
  const read = (await notes.read(ctx, {})).text;
  expect(read).toContain("3 litres");
  expect(read).not.toContain("2 litres");
  expect(asked).toHaveLength(0);
  expect(emitted.map((e) => [e.chatId, e.a])).toEqual([["c1", { kind: "saved", title: "Milk" }], ["c1", { kind: "read", title: "notes" }], ["c1", { kind: "edited", title: "Milk" }], ["c1", { kind: "read", title: "notes" }]]);
});

test("notes are per chat: another chat's notes are not visible from here by default", async () => {
  const { notes, ctx } = setup();
  await notes.save({ userId: "u1", chatId: "c2" }, { title: "Hotel", body: "Alfama" });
  expect((await notes.read(ctx, {})).text).toContain("No notes");
});

test("reading another chat needs approval; allowed returns its notes and records where they came from", async () => {
  const { notes, ctx, asked, emitted } = setup("allowed");
  await notes.save({ userId: "u1", chatId: "c2" }, { title: "Hotel", body: "Alfama" });
  emitted.length = 0;
  const r = await notes.read(ctx, { chat: "lisbon trip" });
  expect(r.text).toContain("Alfama");
  expect(asked).toEqual([{ userId: "u1", chatId: "c1", targetChatId: "c2", chatTitle: "Lisbon trip", action: "read" }]);
  expect(emitted[0].a).toEqual({ kind: "read", title: "notes", chat: "Lisbon trip" });
});

test("denied or expired approval returns an error to the model and records the refusal", async () => {
  for (const outcome of ["denied", "expired"] as const) {
    const { notes, ctx, emitted } = setup(outcome);
    await notes.save({ userId: "u1", chatId: "c2" }, { title: "Hotel", body: "Alfama" });
    const r = await notes.read(ctx, { chat: "Lisbon trip" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("Alfama");
    expect(emitted.at(-1)!.a).toEqual(outcome === "denied" ? { kind: "denied", title: "notes", chat: "Lisbon trip" } : { kind: "denied", title: "notes", chat: "Lisbon trip" });
  }
});

test("editing another chat's note needs an edit approval; the note must belong to that chat", async () => {
  const { notes, ctx, asked } = setup("allowed");
  const s = await notes.save({ userId: "u1", chatId: "c2" }, { title: "Hotel", body: "Alfama" });
  const id = /note_[0-9a-f]+/.exec(s.text)![0];
  const mine = await notes.save(ctx, { title: "Milk", body: "2" });
  const myId = /note_[0-9a-f]+/.exec(mine.text)![0];
  expect((await notes.edit(ctx, { id, body: "Baixa", chat: "Lisbon trip" })).isError).toBeFalsy();
  expect(asked.at(-1)).toMatchObject({ action: "edit", targetChatId: "c2" });
  expect((await notes.edit(ctx, { id: myId, body: "x", chat: "Lisbon trip" })).isError).toBe(true); // wrong chat
  expect((await notes.edit(ctx, { id })).isError).toBe(true); // not in this chat, no chat given
});

test("another user's chats are never reachable, even by exact title", async () => {
  const { notes, ctx, asked } = setup("allowed");
  const r = await notes.read(ctx, { chat: "Secret" });
  expect(r.isError).toBe(true);
  expect(asked).toHaveLength(0);
});

test("a vague chat name that matches several chats is refused with the candidates, an exact one wins", async () => {
  const { notes, ctx } = setup("allowed");
  const vague = await notes.read(ctx, { chat: "lisbon" });
  expect(vague.isError).toBe(true);
  expect(vague.text).toContain("Lisbon trip");
  expect(vague.text).toContain("Lisbon budget");
  expect((await notes.read(ctx, { chat: "Lisbon budget" })).isError).toBeFalsy();
  expect((await notes.read(ctx, { chat: "nothing like it" })).isError).toBe(true);
});

test("naming the current chat is not cross-chat", async () => {
  const { notes, ctx, asked } = setup("denied");
  expect((await notes.read(ctx, { chat: "Groceries" })).isError).toBeFalsy();
  expect((await notes.read(ctx, { chat: "c1" })).isError).toBeFalsy();
  expect(asked).toHaveLength(0);
});

test("input limits", async () => {
  const { notes, ctx } = setup();
  expect((await notes.save(ctx, { title: "", body: "x" })).isError).toBe(true);
  expect((await notes.save(ctx, { title: "t", body: "" })).isError).toBe(true);
  expect((await notes.save(ctx, { title: "t".repeat(200), body: "x" })).isError).toBe(true);
  expect((await notes.save(ctx, { title: "t", body: "x".repeat(20_001) })).isError).toBe(true);
  for (let i = 0; i < 50; i++) await notes.save(ctx, { title: `n${i}`, body: "x" });
  expect((await notes.save(ctx, { title: "one too many", body: "x" })).isError).toBe(true);
});

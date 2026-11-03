import { expect, test } from "bun:test";
import type { StreamEvent } from "@koremind/shared";
import { openDb } from "../src/db";
import { createChats } from "../src/chats";
import { FakeEngine } from "../src/engine/fake";
import type { EngineEvent } from "../src/engine/types";

const model = { providerId: "opencode", modelId: "fast" };
const req = (text: string, over: object = {}) => ({ text, attachmentIds: [], model, ...over });
const collect = async (it: AsyncIterable<StreamEvent>) => { const o: StreamEvent[] = []; for await (const e of it) o.push(e); return o; };

function setup(engineOpts: ConstructorParameters<typeof FakeEngine>[0] = {}, deps: Partial<Parameters<typeof createChats>[2]> = {}) {
  const db = openDb(":memory:");
  for (const u of ["u1", "u2"]) db.run("insert into users(id,email,password_hash,is_owner,created_at) values(?,?,?,?,1)", [u, `${u}@x.co`, "h", u === "u1" ? 1 : 0]);
  const engine = new FakeEngine(engineOpts);
  const completed: string[][] = [];
  const chats = createChats(db, engine, {
    buildSystem: () => "SYSTEM",
    readUpload: (id) => (id === "up1" ? { name: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AA==" } : null),
    onTurnComplete: (_u, a, b) => { completed.push([a, b]); },
    ...deps,
  });
  return { db, engine, chats, completed };
}

test("send persists the user message before the first event", async () => {
  const { chats } = setup();
  const c = chats.create("u1");
  const it = chats.send("u1", c.id, req("hello"), new AbortController().signal)[Symbol.asyncIterator]();
  await it.next();
  expect(chats.get("u1", c.id)!.messages[0]).toMatchObject({ role: "user", text: "hello" });
  await it.return?.();
});

test("send streams deltas then done and persists the assistant message", async () => {
  const { chats } = setup({ reply: () => [{ type: "delta", text: "Hel" }, { type: "delta", text: "lo" }] });
  const c = chats.create("u1");
  const evs = await collect(chats.send("u1", c.id, req("hi"), new AbortController().signal));
  expect(evs.map((e) => e.type)).toEqual(["status", "delta", "delta", "done"]);
  const msgs = chats.get("u1", c.id)!.messages;
  expect(msgs.map((m) => [m.role, m.text])).toEqual([["user", "hi"], ["assistant", "Hello"]]);
  const done = evs[evs.length - 1];
  expect(done.type === "done" && done.messageId).toBe(msgs[1].id);
});

test("a dropped stream saves the partial assistant text", async () => {
  const { chats } = setup({ reply: () => [{ type: "delta", text: "part" }, { type: "delta", text: "ial" }, { type: "delta", text: "!" }] });
  const c = chats.create("u1");
  const it = chats.send("u1", c.id, req("hi"), new AbortController().signal)[Symbol.asyncIterator]();
  await it.next(); await it.next(); await it.next(); // status, "part", "ial"
  await it.return?.(); // client disconnects
  const msgs = chats.get("u1", c.id)!.messages;
  expect(msgs[1]).toMatchObject({ role: "assistant", text: "partial" });
});

test("a chat of another user is not readable", () => {
  const { chats } = setup();
  const c = chats.create("u1");
  expect(chats.get("u2", c.id)).toBeNull();
  expect(chats.has("u2", c.id)).toBe(false);
  expect(chats.list("u2")).toEqual([]);
});

test("title is the first 48 chars of the first message", async () => {
  const { chats } = setup();
  const c = chats.create("u1");
  const long = "x".repeat(80);
  await collect(chats.send("u1", c.id, req(long), new AbortController().signal));
  await collect(chats.send("u1", c.id, req("second"), new AbortController().signal));
  expect(chats.get("u1", c.id)!.chat.title).toBe("x".repeat(48));
});

test("abort emits error aborted and keeps partial text", async () => {
  const { chats } = setup({ reply: () => Array.from({ length: 30 }, (_, i) => ({ type: "delta", text: `${i}` }) as EngineEvent), delayMs: 10 });
  const c = chats.create("u1");
  const evs: StreamEvent[] = [];
  for await (const e of chats.send("u1", c.id, req("go"), new AbortController().signal)) {
    evs.push(e);
    if (evs.length === 3) chats.abort(c.id);
  }
  const last = evs[evs.length - 1];
  expect(last.type === "error" && last.code).toBe("aborted");
  expect(chats.get("u1", c.id)!.messages[1].text.length).toBeGreaterThan(0);
});

test("onTurnComplete is called once after done and not on error", async () => {
  const ok = setup({ reply: () => [{ type: "delta", text: "A" }] });
  const c = ok.chats.create("u1");
  await collect(ok.chats.send("u1", c.id, req("q"), new AbortController().signal));
  expect(ok.completed).toEqual([["q", "A"]]);
  const bad = setup({ reply: () => [{ type: "delta", text: "A" }, { type: "error", message: "boom" }] });
  const c2 = bad.chats.create("u1");
  await collect(bad.chats.send("u1", c2.id, req("q"), new AbortController().signal));
  expect(bad.completed).toEqual([]);
});

test("engine noProvider error becomes no_provider", async () => {
  const { chats } = setup({ reply: () => [{ type: "error", message: "Free usage limit reached", noProvider: true }] });
  const c = chats.create("u1");
  const evs = await collect(chats.send("u1", c.id, req("hi"), new AbortController().signal));
  const last = evs[evs.length - 1];
  expect(last.type === "error" && [last.code, last.message]).toEqual(["no_provider", "Free usage limit reached"]);
});

test("context goes only with the first prompt and attachments reach the engine", async () => {
  const { chats, engine } = setup();
  const c = chats.create("u1");
  await collect(chats.send("u1", c.id, req("one", { attachmentIds: ["up1"] }), new AbortController().signal));
  await collect(chats.send("u1", c.id, req("two"), new AbortController().signal));
  expect(engine.prompts[0].system).toBe("SYSTEM");
  expect(engine.prompts[0].files[0].name).toBe("a.png");
  expect(engine.prompts[1].system).toBe("");
});

test("sources are saved with the assistant message", async () => {
  const { chats } = setup({ reply: () => [{ type: "status", state: "searching" }, { type: "source", title: "Bun", url: "https://bun.sh" }, { type: "delta", text: "ok" }] });
  const c = chats.create("u1");
  await collect(chats.send("u1", c.id, req("news"), new AbortController().signal));
  expect(chats.get("u1", c.id)!.messages[1].sources).toEqual([{ title: "Bun", url: "https://bun.sh" }]);
});

test("remove deletes the chat and its engine session", async () => {
  const { chats, engine } = setup();
  const c = chats.create("u1");
  await collect(chats.send("u1", c.id, req("hi"), new AbortController().signal));
  expect(engine.sessions.size).toBe(1);
  await chats.remove("u1", c.id);
  expect(chats.get("u1", c.id)).toBeNull();
  expect(engine.sessions.size).toBe(0);
});

test("after the first turn the chat is titled by the chosen model, and the title is streamed after done", async () => {
  const { chats, engine, db } = setup({ reply: () => [{ type: "delta", text: "Sure, Lisbon is lovely in May." }], titleReply: '"Lisbon trip in May."\n' });
  const c = chats.create("u1");
  const evs = await collect(chats.send("u1", c.id, req("Plan a week in Lisbon", { model: { providerId: "openrouter", modelId: "x/y" } }), new AbortController().signal));
  expect(evs.map((e) => e.type)).toEqual(["status", "delta", "done", "title"]);
  expect(evs.at(-1)).toEqual({ type: "title", title: "Lisbon trip in May" });
  expect(chats.get("u1", c.id)!.chat.title).toBe("Lisbon trip in May");
  const call = engine.completes.find((x) => x.kind === "title")!;
  expect(call.model).toEqual({ providerId: "openrouter", modelId: "x/y" });
  expect(call.text).toContain("Plan a week in Lisbon");
  expect(call.text).toContain("Lisbon is lovely");
  expect((db.query("select title from chats where id=?").get(c.id) as { title: string }).title).toBe("Lisbon trip in May");
});

test("only the first turn is titled", async () => {
  const { chats, engine } = setup({ titleReply: "First title" });
  const c = chats.create("u1");
  await collect(chats.send("u1", c.id, req("one"), new AbortController().signal));
  await collect(chats.send("u1", c.id, req("two"), new AbortController().signal));
  expect(engine.completes.filter((x) => x.kind === "title")).toHaveLength(1);
});

test("a failed or empty title keeps the first-words title and never breaks the chat", async () => {
  const empty = setup({ titleReply: "  " });
  const c1 = empty.chats.create("u1");
  expect((await collect(empty.chats.send("u1", c1.id, req("hello world"), new AbortController().signal))).map((e) => e.type)).toEqual(["status", "delta", "done"]);
  expect(empty.chats.get("u1", c1.id)!.chat.title).toBe("hello world");

  const boom = setup({ titleReply: () => { throw new Error("quota"); } });
  const c2 = boom.chats.create("u1");
  expect((await collect(boom.chats.send("u1", c2.id, req("hello again"), new AbortController().signal))).at(-1)!.type).toBe("done");
  expect(boom.chats.get("u1", c2.id)!.chat.title).toBe("hello again");
});

test("a title the owner typed while it was being generated is not overwritten", async () => {
  const { chats } = setup({ titleReply: "Generated", completeDelayMs: 40 });
  const c = chats.create("u1");
  const evs: StreamEvent[] = [];
  for await (const e of chats.send("u1", c.id, req("hello"), new AbortController().signal)) {
    evs.push(e);
    if (e.type === "done") chats.rename("u1", c.id, "Mine");
  }
  expect(evs.at(-1)!.type).toBe("done");
  await Bun.sleep(80);
  expect(chats.get("u1", c.id)!.chat.title).toBe("Mine");
});

test("memory extraction receives the model the chat used", async () => {
  const seen: unknown[] = [];
  const { chats } = setup({}, { onTurnComplete: (_u, _a, _b, m) => { seen.push(m); } });
  const c = chats.create("u1");
  await collect(chats.send("u1", c.id, req("q", { model: { providerId: "openai", modelId: "gpt" } }), new AbortController().signal));
  expect(seen).toEqual([{ providerId: "openai", modelId: "gpt" }]);
});

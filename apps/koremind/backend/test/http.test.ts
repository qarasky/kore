import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamEvent } from "@koremind/shared";
import { createApp } from "../src/http";
import { createServices } from "../src/services";
import { openDb } from "../src/db";
import { FakeEngine } from "../src/engine/fake";
import { addUser } from "./helpers";

const setup = (engine = new FakeEngine({ reply: () => [{ type: "delta", text: "Hi " }, { type: "delta", text: "there" }] }), maxUpload = 1024, appOpts: { trustProxy?: boolean; keepAliveMs?: number } = { trustProxy: true }) => {
  const services = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "koremind-http-")), engine, version: "0.0.0-test", maxUploadBytes: maxUpload });
  const app = createApp(services, appOpts);
  const call = (method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData; ip?: string; socketIp?: string } = {}) =>
    app.fetch(new Request("http://koremind.test" + path, {
      method,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.ip !== null ? { "x-forwarded-for": opts.ip ?? "1.1.1.1" } : {}) },
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    }), opts.socketIp);
  /** A Kore ID-provisioned account plus a session; there is no password route to call. */
  const signIn = (email = "me@home.lan", owner = true) => services.auth.issueFor(addUser(services.db, email, { owner, sub: `sub-${email}` }).id).token;
  return { call, engine, services, signIn };
};
const frames = async (res: Response): Promise<StreamEvent[]> =>
  (await res.text()).split("\n\n").filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, "")));
const model = { providerId: "opencode", modelId: "fast" };

test("GET /health reports setupRequired true on an empty db", async () => {
  const { call, signIn } = setup();
  expect(await (await call("GET", "/health")).json()).toEqual({ name: "koremind", version: "0.0.0-test", setupRequired: true, sso: false });
  signIn();
  expect(((await (await call("GET", "/health")).json()) as { setupRequired: boolean }).setupRequired).toBe(false);
});

test("password sign-in and registration routes are gone", async () => {
  const { call, signIn } = setup();
  const token = signIn();
  for (const path of ["/auth/login", "/auth/register"]) {
    const res = await call("POST", path, { token, body: { email: "me@home.lan", password: "correct horse" } });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("not_found");
  }
});

test("unauthenticated /chats returns 401", async () => {
  expect((await setup().call("GET", "/chats")).status).toBe(401);
});

test("an invalid body returns 400", async () => {
  expect((await setup().call("POST", "/auth/pair/redeem", { body: {} })).status).toBe(400);
});

test("a session can send and streams SSE events ending in done", async () => {
  const { call, signIn } = setup();
  const token = signIn();
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  const res = await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "hello", attachmentIds: [], model } });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const evs = await frames(res);
  expect(evs.map((e) => e.type)).toEqual(["status", "delta", "delta", "done"]);
  const got = (await (await call("GET", `/chats/${chat.id}`, { token })).json()) as { messages: { text: string }[] };
  expect(got.messages.map((m) => m.text)).toEqual(["hello", "Hi there"]);
  expect((await call("GET", "/chats", { token })).status).toBe(200);
});

test("POST /uploads then send includes the file", async () => {
  const { call, engine, signIn } = setup();
  const token = signIn();
  const form = new FormData();
  form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  const att = (await (await call("POST", "/uploads", { token, form })).json()) as { id: string };
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  await frames(await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "see file", attachmentIds: [att.id], model } }));
  expect(engine.prompts[0].files[0]).toMatchObject({ name: "note.txt", mime: "text/plain" });
  expect((await call("GET", `/uploads/${att.id}`, { token })).status).toBe(200);
  // The session token is accepted only in the Authorization header: tokens in URLs end up in logs and history.
  expect((await call("GET", `/uploads/${att.id}?token=${token}`)).status).toBe(401);
  expect((await call("GET", `/me?token=${token}`)).status).toBe(401);
});

test("a file listed many times in one message is read once", async () => {
  const { call, engine, signIn } = setup();
  const token = signIn();
  const form = new FormData();
  form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  const att = (await (await call("POST", "/uploads", { token, form })).json()) as { id: string };
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  await frames(await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "x", attachmentIds: Array(50).fill(att.id), model } }));
  expect(engine.prompts[0].files).toHaveLength(1);
});

test("more than 10 files in one message is refused", async () => {
  const { call, engine, signIn } = setup();
  const token = signIn();
  const ids: string[] = [];
  for (let i = 0; i < 11; i++) {
    const form = new FormData();
    form.set("file", new File([`f${i}`], `f${i}.txt`, { type: "text/plain" }));
    ids.push(((await (await call("POST", "/uploads", { token, form })).json()) as { id: string }).id);
  }
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  const res = await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "x", attachmentIds: ids, model } });
  expect(res.status).toBe(400);
  expect(engine.prompts).toHaveLength(0);
});

test("an oversized upload returns 413 with a message", async () => {
  const { call, signIn } = setup(undefined, 10);
  const token = signIn();
  const form = new FormData();
  form.set("file", new File([new Uint8Array(50)], "big.png", { type: "image/png" }));
  const res = await call("POST", "/uploads", { token, form });
  expect(res.status).toBe(413);
  expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "attachment_too_large" });
});

test("memory and settings routes round trip", async () => {
  const { call, services, signIn } = setup();
  const token = signIn();
  const put = await call("PUT", "/settings", { token, body: { memoryEnabled: true, displayName: "Sky", tone: "short", about: "dev" } });
  expect(((await put.json()) as { displayName: string }).displayName).toBe("Sky");
  expect(((await (await call("GET", "/settings", { token })).json()) as { tone: string }).tone).toBe("short");
  const me = (await (await call("GET", "/me", { token })).json()) as { id: string };
  expect(await (await call("GET", "/memory", { token })).json()).toEqual([]);
  expect(await (await call("GET", "/memory/summary", { token })).json()).toEqual({ summary: null });
  services.memory.tools.remember({ userId: me.id, chatId: "c" }, { text: "Likes tea" });
  await services.memory.refreshNow(me.id);
  expect(((await (await call("GET", "/memory", { token })).json()) as { text: string }[]).map((e) => e.text)).toEqual(["Likes tea"]);
  expect(((await (await call("GET", "/memory/summary", { token })).json()) as { summary: { text: string } }).summary.text).toBe("A fake profile of the user.");
});

test("favorites validate against the models on offer", async () => {
  const { call, signIn } = setup();
  const token = signIn();
  const fav = await call("PUT", "/favorites", { token, body: ["opencode/fast", "x/y"] });
  expect(await fav.json()).toEqual(["opencode/fast"]);
  const models = (await (await call("GET", "/models", { token })).json()) as { id: string }[];
  expect(models.map((m) => m.id)).toContain("opencode");
});

test("CORS preflight is allowed", async () => {
  const res = await setup().call("OPTIONS", "/chats");
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("connecting a provider from the app is gone", async () => {
  const { call, signIn, engine } = setup();
  const owner = signIn();
  expect((await call("PUT", "/providers/claude/key", { token: owner, body: { key: "sk-x" } })).status).toBe(404);
  expect((await call("DELETE", "/providers/claude/key", { token: owner })).status).toBe(404);
  expect((await call("POST", "/providers/claude/signin", { token: owner })).status).toBe(404);
  expect((await call("GET", "/providers/claude/signin/at_1", { token: owner })).status).toBe(404);
  const list = (await (await call("GET", "/providers", { token: owner })).json()) as Record<string, unknown>[];
  expect(list.map((p) => p.id)).toEqual(["claude", "opencode", "opencode-go"]);
  for (const p of list) expect(Object.keys(p).sort()).toEqual(["connected", "hint", "id", "name", "supportsFreeFilter"]);
  expect(list.find((p) => p.id === "claude")).toMatchObject({ connected: false });
  expect(String(list.find((p) => p.id === "claude")!.hint)).toContain("claude auth login");
  engine.connected.add("claude");
  expect(((await (await call("GET", "/providers", { token: owner })).json()) as Record<string, unknown>[]).find((p) => p.id === "claude")).toMatchObject({ connected: true, hint: "" });
});

test("a non-owner can't send to Claude", async () => {
  const { call, signIn, engine } = setup();
  engine.connected.add("claude");
  signIn();
  const kid = signIn("kid@home.lan", false);
  const chat = (await (await call("POST", "/chats", { token: kid })).json()) as { id: string };
  const res = await call("POST", `/chats/${chat.id}/messages`, { token: kid, body: { text: "hi", attachmentIds: [], model: { providerId: "claude", modelId: "claude-sonnet-5-5" } } });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("model_not_allowed");
  expect(engine.prompts).toHaveLength(0);
});

test("behind a local tunnel the forwarded address is used for pairing rate limits", async () => {
  const { call } = setup(undefined, 1024, { trustProxy: false });
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call("POST", "/auth/pair/redeem", { body: { code: `bad${i}` }, ip: "7.7.7.7", socketIp: "127.0.0.1" })).status;
  expect(last).toBe(429);
  expect((await call("POST", "/auth/pair/redeem", { body: { code: "bad" }, ip: "8.8.8.8", socketIp: "127.0.0.1" })).status).toBe(401);
});

test("a remote client cannot spoof x-forwarded-for to dodge the pairing lockout", async () => {
  const { call } = setup(undefined, 1024, { trustProxy: false });
  let last = 0;
  for (let i = 0; i < 11; i++) last = (await call("POST", "/auth/pair/redeem", { body: { code: `bad${i}` }, ip: `9.9.9.${i}`, socketIp: "203.0.113.5" })).status;
  expect(last).toBe(429);
});

test("slow replies keep the stream alive with comment pings", async () => {
  const slow = new FakeEngine({ reply: () => [{ type: "delta", text: "late" }], delayMs: 120 });
  const { call, signIn } = setup(slow, 1024, { trustProxy: true, keepAliveMs: 30 });
  const token = signIn();
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  const raw = await (await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "hi", attachmentIds: [], model } })).text();
  expect(raw).toContain(": ping");
  const evs = raw.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)));
  expect(evs[evs.length - 1].type).toBe("done");
});

test("provider settings change what /models returns, and a disallowed model is refused before streaming", async () => {
  const { call, engine, signIn } = setup();
  const token = signIn();
  engine.connected.add("opencode-go");
  const list = async () => (await (await call("GET", "/models", { token })).json()) as { id: string; status: string; models: { id: string; free: boolean }[] }[];
  expect((await list()).map((p) => p.id)).toEqual(["claude", "opencode", "opencode-go"]);
  expect((await list()).find((p) => p.id === "opencode-go")!.status).toBe("ready");

  const put = (patch: object) => call("PUT", "/settings", { token, body: { memoryEnabled: true, displayName: "", tone: "", about: "", disabledProviders: [], freeOnlyProviders: [], ...patch } });
  await put({ freeOnlyProviders: ["opencode"] });
  expect((await list()).find((p) => p.id === "opencode")!.models.every((m) => m.free)).toBe(true);
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  const refused = await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "hi", attachmentIds: [], model: { providerId: "opencode", modelId: "vision" } } });
  expect(refused.status).toBe(400);
  expect(await refused.text()).toContain("model_not_allowed");
  expect(engine.prompts).toHaveLength(0);

  await put({ disabledProviders: ["opencode-go"] });
  expect((await list()).find((p) => p.id === "opencode-go")!.status).toBe("disabled");
  const ok = await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "hi", attachmentIds: [], model } });
  expect(ok.status).toBe(200);
  await ok.text();
});

test("older clients that omit the new settings fields still save", async () => {
  const { call, signIn } = setup();
  const token = signIn();
  const r = await call("PUT", "/settings", { token, body: { memoryEnabled: true, displayName: "Sky", tone: "", about: "" } });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ displayName: "Sky", disabledProviders: [], freeOnlyProviders: [] });
});

test("pairing over HTTP: signed-in start, anonymous redeem, link carries code and addresses", async () => {
  const { call, signIn } = setup();
  const token = signIn();
  expect((await call("POST", "/auth/pair")).status).toBe(401);
  const pair = (await (await call("POST", "/auth/pair", { token })).json()) as { code: string; urls: string[]; link: string; expiresAt: number };
  expect(pair.urls.length).toBeGreaterThan(0);
  const link = new URL(pair.link);
  expect(link.protocol).toBe("koremind:");
  expect(link.searchParams.get("c")).toBe(pair.code);
  expect(link.searchParams.getAll("u")).toEqual(pair.urls);
  const redeemed = await call("POST", "/auth/pair/redeem", { body: { code: pair.code } });
  expect(redeemed.status).toBe(200);
  const device = (await redeemed.json()) as { token: string; user: { email: string } };
  expect(device.user.email).toBe("me@home.lan");
  const me = await call("GET", "/me", { token: device.token });
  expect(me.status).toBe(200);
  const again = await call("POST", "/auth/pair/redeem", { body: { code: pair.code } });
  expect(again.status).toBe(401);
  expect(await again.text()).toContain("bad_code");
});

test("closing the connection mid-answer leaves the answer running; the app can re-attach and read it whole", async () => {
  const engine = new FakeEngine({ reply: () => [{ type: "delta", text: "one " }, { type: "delta", text: "two " }, { type: "delta", text: "three" }], delayMs: 15 });
  const { call, signIn } = setup(engine);
  const token = signIn();
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  const res = await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "count", attachmentIds: [], model } });
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel(); // the phone switched apps

  expect(((await (await call("GET", `/chats/${chat.id}`, { token })).json()) as { running: boolean }).running).toBe(true);
  const busy = await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "again", attachmentIds: [], model } });
  expect(busy.status).toBe(409);
  const again = await call("GET", `/chats/${chat.id}/stream`, { token });
  expect(again.headers.get("content-type")).toContain("text/event-stream");
  const evs = await frames(again);
  expect(evs.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe("one two three");
  expect(evs.at(-1)!.type).toBe("done");

  const got = (await (await call("GET", `/chats/${chat.id}`, { token })).json()) as { running: boolean; messages: { text: string }[] };
  expect(got.running).toBe(false);
  expect(got.messages.map((m) => m.text)).toEqual(["count", "one two three"]);
  expect((await call("GET", `/chats/${chat.id}/stream`, { token })).status).toBe(204);
});

test("variants: edit over HTTP, then switch back with /branch", async () => {
  const engine = new FakeEngine({ reply: (a) => [{ type: "delta", text: `re: ${a.text}` }] });
  const { call, signIn } = setup(engine);
  const token = signIn();
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  await frames(await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "a", attachmentIds: [], model } }));
  const first = ((await (await call("GET", `/chats/${chat.id}`, { token })).json()) as { messages: { id: string }[] }).messages[0];
  await frames(await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "b", attachmentIds: [], model, editOf: first.id } }));
  type Detail = { messages: { id: string; text: string; siblings?: string[] }[] };
  const edited = (await (await call("GET", `/chats/${chat.id}`, { token })).json()) as Detail;
  expect(edited.messages.map((m) => m.text)).toEqual(["b", "re: b"]);
  expect(edited.messages[0].siblings).toEqual([first.id, edited.messages[0].id]);
  const back = (await (await call("POST", `/chats/${chat.id}/branch`, { token, body: { messageId: first.id } })).json()) as Detail;
  expect(back.messages.map((m) => m.text)).toEqual(["a", "re: a"]);
  expect((await call("POST", `/chats/${chat.id}/branch`, { token, body: { messageId: "nope" } })).status).toBe(404);
});

test("/mcp passes x-koremind-session through", async () => {
  const { services, signIn } = setup();
  const app = createApp(services, { trustProxy: true });
  signIn();
  const me = services.db.query("select id from users limit 1").get() as { id: string };
  const chat = services.chats.create(me.id);
  services.db.run("update chats set engine_session_id=? where id=?", ["claude-sess-1", chat.id]);
  const res = await app.fetch(new Request("http://koremind.test/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${services.mcpSecret}`, "content-type": "application/json", "x-koremind-session": "claude-sess-1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save_note", arguments: { title: "Milk", body: "2 litres" } } }),
  }), "127.0.0.1");
  expect(res.status).toBe(200);
  expect(((await res.json()) as any).result.isError).toBeUndefined();
  expect((await services.notes.read({ userId: me.id, chatId: chat.id }, {})).text).toContain("2 litres");
});

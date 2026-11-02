import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamEvent } from "@zero/shared";
import { createApp } from "../src/http";
import { createServices } from "../src/services";
import { openDb } from "../src/db";
import { FakeEngine } from "../src/engine/fake";

const setup = (engine = new FakeEngine({ reply: () => [{ type: "delta", text: "Hi " }, { type: "delta", text: "there" }] }), maxUpload = 1024, appOpts: { trustProxy?: boolean; keepAliveMs?: number } = { trustProxy: true }) => {
  const services = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "zero-http-")), engine, version: "0.0.0-test", maxUploadBytes: maxUpload });
  const app = createApp(services, appOpts);
  const call = (method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData; ip?: string; socketIp?: string } = {}) =>
    app.fetch(new Request("http://zero.test" + path, {
      method,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.ip !== null ? { "x-forwarded-for": opts.ip ?? "1.1.1.1" } : {}) },
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    }), opts.socketIp);
  return { call, engine, services };
};
const creds = { email: "me@home.lan", password: "correct horse" };
const register = async (call: ReturnType<typeof setup>["call"]) => ((await (await call("POST", "/auth/register", { body: creds })).json()) as { token: string }).token;
const frames = async (res: Response): Promise<StreamEvent[]> =>
  (await res.text()).split("\n\n").filter(Boolean).map((f) => JSON.parse(f.replace(/^data: /, "")));
const model = { providerId: "opencode", modelId: "fast" };

test("GET /health reports setupRequired true on an empty db", async () => {
  const { call } = setup();
  expect(await (await call("GET", "/health")).json()).toEqual({ name: "zero", version: "0.0.0-test", setupRequired: true });
  await register(call);
  expect(((await (await call("GET", "/health")).json()) as { setupRequired: boolean }).setupRequired).toBe(false);
});

test("unauthenticated /chats returns 401", async () => {
  expect((await setup().call("GET", "/chats")).status).toBe(401);
});

test("register is closed after the first account", async () => {
  const { call } = setup();
  await register(call);
  expect((await call("POST", "/auth/register", { body: { email: "b@home.lan", password: "another pass" } })).status).toBe(403);
});

test("invalid body returns 400", async () => {
  expect((await setup().call("POST", "/auth/register", { body: { email: "nope", password: "x" } })).status).toBe(400);
});

test("repeated wrong logins return 429 with retryAfterSec", async () => {
  const { call } = setup();
  await register(call);
  let last: Response | null = null;
  for (let i = 0; i < 6; i++) last = await call("POST", "/auth/login", { body: { ...creds, password: "wrong password" }, ip: "7.7.7.7" });
  expect(last!.status).toBe(429);
  expect(((await last!.json()) as { error: { retryAfterSec: number } }).error.retryAfterSec).toBeGreaterThan(0);
});

test("register then login then send streams SSE events ending in done", async () => {
  const { call } = setup();
  await register(call);
  const token = ((await (await call("POST", "/auth/login", { body: creds })).json()) as { token: string }).token;
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
  const { call, engine } = setup();
  const token = await register(call);
  const form = new FormData();
  form.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
  const att = (await (await call("POST", "/uploads", { token, form })).json()) as { id: string };
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  await frames(await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "see file", attachmentIds: [att.id], model } }));
  expect(engine.prompts[0].files[0]).toMatchObject({ name: "note.txt", mime: "text/plain" });
  expect((await call("GET", `/uploads/${att.id}`, { token })).status).toBe(200);
  expect((await call("GET", `/uploads/${att.id}?token=${token}`)).status).toBe(200);
});

test("an oversized upload returns 413 with a message", async () => {
  const { call } = setup(undefined, 10);
  const token = await register(call);
  const form = new FormData();
  form.set("file", new File([new Uint8Array(50)], "big.png", { type: "image/png" }));
  const res = await call("POST", "/uploads", { token, form });
  expect(res.status).toBe(413);
  expect(((await res.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: "attachment_too_large" });
});

test("memory and settings routes round trip", async () => {
  const { call, services } = setup();
  const token = await register(call);
  const put = await call("PUT", "/settings", { token, body: { memoryEnabled: true, displayName: "Sky", tone: "short", about: "dev" } });
  expect(((await put.json()) as { displayName: string }).displayName).toBe("Sky");
  expect(((await (await call("GET", "/settings", { token })).json()) as { tone: string }).tone).toBe("short");
  const me = (await (await call("GET", "/me", { token })).json()) as { id: string };
  (services.engine as FakeEngine); // memory seeded through the real store
  await services.memory.extractAfterTurn(me.id, "a", "b"); // fake returns {"add":[]}
  expect(await (await call("GET", "/memory", { token })).json()).toEqual([]);
});

test("provider key route never echoes the key and favorites validate", async () => {
  const { call, engine } = setup();
  const token = await register(call);
  const res = await call("PUT", "/providers/opencode/key", { token, body: { key: "sk-secret-123" } });
  expect(await res.text()).not.toContain("sk-secret-123");
  expect(engine.keys.get("opencode")).toBe("sk-secret-123");
  const fav = await call("PUT", "/favorites", { token, body: ["opencode/fast", "x/y"] });
  expect(await fav.json()).toEqual(["opencode/fast"]);
  const models = (await (await call("GET", "/models", { token })).json()) as { id: string }[];
  expect(models[0].id).toBe("opencode");
});

test("CORS preflight is allowed", async () => {
  const res = await setup().call("OPTIONS", "/chats");
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("only the owner can change provider keys", async () => {
  const { call, engine } = setup();
  const owner = await register(call);
  const second = (await (await call("POST", "/auth/register", { token: owner, body: { email: "kid@home.lan", password: "another pass" } })).json()) as { token: string };
  expect((await call("PUT", "/providers/opencode/key", { token: second.token, body: { key: "sk-evil" } })).status).toBe(403);
  expect((await call("DELETE", "/providers/opencode/key", { token: second.token })).status).toBe(403);
  expect(engine.keys.has("opencode")).toBe(false);
  expect((await call("PUT", "/providers/opencode/key", { token: owner, body: { key: "sk-ok" } })).status).toBe(200);
});

test("behind a local tunnel the forwarded address is used, so one attacker cannot lock out the owner everywhere", async () => {
  const { call } = setup(undefined, 1024, { trustProxy: false });
  await register(call);
  for (let i = 0; i < 6; i++) await call("POST", "/auth/login", { body: { ...creds, password: "wrong password" }, ip: "7.7.7.7", socketIp: "127.0.0.1" });
  expect((await call("POST", "/auth/login", { body: creds, ip: "8.8.8.8", socketIp: "127.0.0.1" })).status).toBe(200);
});

test("a remote client cannot spoof x-forwarded-for to dodge the lockout", async () => {
  const { call } = setup(undefined, 1024, { trustProxy: false });
  await register(call);
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await call("POST", "/auth/login", { body: { ...creds, password: "wrong password" }, ip: `9.9.9.${i}`, socketIp: "203.0.113.5" })).status;
  expect(last).toBe(429);
});

test("slow replies keep the stream alive with comment pings", async () => {
  const slow = new FakeEngine({ reply: () => [{ type: "delta", text: "late" }], delayMs: 120 });
  const { call } = setup(slow, 1024, { trustProxy: true, keepAliveMs: 30 });
  const token = await register(call);
  const chat = (await (await call("POST", "/chats", { token })).json()) as { id: string };
  const raw = await (await call("POST", `/chats/${chat.id}/messages`, { token, body: { text: "hi", attachmentIds: [], model } })).text();
  expect(raw).toContain(": ping");
  const evs = raw.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)));
  expect(evs[evs.length - 1].type).toBe("done");
});

test("provider list shows login methods; sign-in is owner-only and reports progress", async () => {
  const { call, engine } = setup();
  const owner = await register(call);
  const list = (await (await call("GET", "/providers", { token: owner })).json()) as { id: string; methods: string[]; connected: boolean }[];
  expect(list.map((p) => p.id)).toEqual(["opencode", "openai", "openrouter"]);
  expect(list.find((p) => p.id === "openai")?.methods).toEqual(["key", "signin"]);

  const start = (await (await call("POST", "/providers/openai/signin", { token: owner })).json()) as { attemptId: string; url: string };
  expect(start.url).toStartWith("https://");
  expect(((await (await call("GET", `/providers/openai/signin/${start.attemptId}`, { token: owner })).json()) as { status: string }).status).toBe("pending");
  engine.finishSignIn(start.attemptId);
  expect(((await (await call("GET", `/providers/openai/signin/${start.attemptId}`, { token: owner })).json()) as { status: string }).status).toBe("complete");
  expect(((await (await call("GET", "/providers", { token: owner })).json()) as { id: string; connected: boolean }[]).find((p) => p.id === "openai")?.connected).toBe(true);

  const second = (await (await call("POST", "/auth/register", { token: owner, body: { email: "kid@home.lan", password: "another pass" } })).json()) as { token: string };
  expect((await call("POST", "/providers/openai/signin", { token: second.token })).status).toBe(403);
});

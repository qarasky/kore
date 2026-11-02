import { expect, test } from "bun:test";
import { FakeEngine } from "../src/engine/fake";
import { AGENT_SYSTEM, credentialIdsFor, mapConnections, mapEvent, mapModels, parseServerBanner } from "../src/engine/opencode";
import type { EngineEvent, PromptArgs } from "../src/engine/types";

const args = (over: Partial<PromptArgs> = {}): PromptArgs => ({
  sessionId: "s1", system: "", text: "hi", files: [],
  model: { providerId: "opencode", modelId: "big-pickle" }, signal: new AbortController().signal, ...over,
});
const collect = async (it: AsyncIterable<EngineEvent>) => { const out: EngineEvent[] = []; for await (const e of it) out.push(e); return out; };

test("fake prompt yields events in order and ends with done", async () => {
  const e = new FakeEngine({ reply: () => [{ type: "delta", text: "a" }, { type: "delta", text: "b" }] });
  const evs = await collect(e.prompt(args()));
  expect(evs.map((x) => x.type)).toEqual(["status", "delta", "delta", "done"]);
});

test("fake abort signal stops the stream", async () => {
  const e = new FakeEngine({ reply: () => Array.from({ length: 50 }, () => ({ type: "delta", text: "x" }) as EngineEvent), delayMs: 5 });
  const ac = new AbortController();
  const evs: EngineEvent[] = [];
  for await (const ev of e.prompt(args({ signal: ac.signal }))) { evs.push(ev); if (evs.length === 3) ac.abort(); }
  expect(evs.length).toBeLessThan(10);
});

test("fake complete returns text", async () => {
  const e = new FakeEngine({ completeReply: '{"add":["likes tea"]}' });
  expect(await e.complete({ system: "s", text: "t" })).toBe('{"add":["likes tea"]}');
});

test("parseServerBanner reads url and password from opencode stdout", () => {
  expect(parseServerBanner("server listening on http://127.0.0.1:50366\nserver password abc-DEF_1\n")).toEqual({ url: "http://127.0.0.1:50366", password: "abc-DEF_1" });
  expect(parseServerBanner("server listening on http://127.0.0.1:1\n")).toBeNull();
});

test("mapEvent maps text delta, success and failure for its own session only", () => {
  expect(mapEvent("s1", { type: "session.text.delta", data: { sessionID: "s1", delta: "hel" } })).toEqual([{ type: "delta", text: "hel" }]);
  expect(mapEvent("s1", { type: "session.text.delta", data: { sessionID: "other", delta: "x" } })).toEqual([]);
  expect(mapEvent("s1", { type: "session.execution.succeeded", data: { sessionID: "s1" } })).toEqual([{ type: "done" }]);
  expect(mapEvent("s1", { type: "session.execution.failed", data: { sessionID: "s1", error: { type: "provider.free-limit", message: "Free usage limit reached" } } })).toEqual([
    { type: "error", message: "Free usage limit reached", noProvider: true },
  ]);
  expect(mapEvent("s1", { type: "session.execution.failed", data: { sessionID: "s1", error: { type: "unknown", message: "boom" } } })).toEqual([{ type: "error", message: "boom" }]);
});

test("mapEvent shows searching and sources for the web search tool", () => {
  expect(mapEvent("s1", { type: "session.tool.called", data: { sessionID: "s1", tool: "websearch", input: { query: "bun" } } })).toEqual([{ type: "status", state: "searching" }]);
  expect(
    mapEvent("s1", { type: "session.tool.success", data: { sessionID: "s1", tool: "websearch", structured: { results: [{ title: "Bun", url: "https://bun.sh" }] } } }),
  ).toEqual([{ type: "source", title: "Bun", url: "https://bun.sh" }]);
});

test("mapModels keeps opencode models only, marks vision, variants and one default", () => {
  const providers = mapModels(
    [{ id: "opencode", name: "OpenCode" }],
    [
      { id: "big-pickle", modelID: "big-pickle", providerID: "opencode", name: "Big Pickle", capabilities: { input: ["text"] }, variants: [], enabled: true, status: "active" },
      { id: "vis", modelID: "vis", providerID: "opencode", name: "Vis", capabilities: { input: ["text", "image"] }, variants: [{ id: "low" }, { id: "high" }], enabled: true, status: "active" },
      { id: "x", modelID: "x", providerID: "other", name: "X", capabilities: { input: ["text"] }, variants: [], enabled: true, status: "active" },
      { id: "off", modelID: "off", providerID: "opencode", name: "Off", capabilities: { input: ["text"] }, variants: [], enabled: false, status: "active" },
    ],
  );
  expect(providers).toHaveLength(1);
  const ms = providers[0].models;
  expect(ms.map((m) => m.id)).toEqual(["big-pickle", "vis"]);
  expect(ms[1]).toMatchObject({ vision: true, thinkingLevels: ["low", "high"] });
  expect(ms.filter((m) => m.isDefault)).toHaveLength(1);
});

import { createOpencodeEngine } from "../src/engine/opencode";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skipIf(!process.env.ZERO_LIVE)("live: opencode lists models and streams a reply (or reports the free limit)", async () => {
  const eng = await createOpencodeEngine({ dataDir: mkdtempSync(join(tmpdir(), "zero-live-")) });
  try {
    const providers = await eng.listProviders();
    expect(providers[0].id).toBe("opencode");
    const def = providers[0].models.find((m) => m.isDefault)!;
    const sid = await eng.createSession({ providerId: "opencode", modelId: def.id });
    const t0 = performance.now();
    const evs = await collect(eng.prompt(args({ sessionId: sid, text: "Reply with the single word pong", model: { providerId: "opencode", modelId: def.id } })));
    const last = evs[evs.length - 1];
    console.log("live events:", evs.map((e) => e.type).join(","), "ms:", Math.round(performance.now() - t0));
    expect(["done", "error"]).toContain(last.type);
  } finally { eng.close(); }
}, 60_000);

test("mapModels marks a provider connected only when a key connection exists", () => {
  const models = [{ id: "m", modelID: "m", providerID: "opencode", name: "M", capabilities: { input: ["text"] }, variants: [], enabled: true, status: "active" }];
  expect(mapModels([{ id: "opencode", name: "OpenCode" }], models, undefined, new Set())[0].connected).toBe(false);
  expect(mapModels([{ id: "opencode", name: "OpenCode" }], models, undefined, new Set(["opencode"]))[0].connected).toBe(true);
});

test("mapModels marks free models by their price tiers and gives every listed provider a status", () => {
  const free = { cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] };
  const paid = { cost: [{ input: 0.05, output: 0.5 }] };
  const mixed = { cost: [{ input: 0, output: 0 }, { input: 1, output: 2 }] };
  const m = (id: string, extra: object) => ({ id, modelID: id, providerID: "openrouter", name: id, capabilities: { input: ["text"] }, variants: [], enabled: true, status: "active", ...extra });
  const out = mapModels([{ id: "openrouter", name: "OpenRouter" }, { id: "openai", name: "Codex" }], [m("a:free", free), m("b", paid), m("c", mixed), m("d", {})], undefined, new Set(["openrouter"]));
  const or = out.find((p) => p.id === "openrouter")!;
  expect(or.models.map((x) => [x.id, x.free])).toEqual([["a:free", true], ["b", false], ["c", false], ["d", false]]);
  expect(or.status).toBe("ready");
  expect(out.find((p) => p.id === "openai")).toMatchObject({ status: "needs_connection", connected: false, models: [] });
  // OpenCode's free tier works without a key.
  expect(mapModels([{ id: "opencode", name: "OpenCode" }], [], undefined, new Set())[0]).toMatchObject({ status: "ready", connected: false });
});

test("mapConnections offers OpenCode, Codex and OpenRouter with their login methods, and nothing else", () => {
  const integrations = [
    { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
    { id: "opencode", name: "OpenCode", methods: [{ type: "key" }, { id: "go", type: "oauth", label: "OpenCode account" }], connections: [] },
    { id: "openrouter", name: "OpenRouter", methods: [{ type: "key" }, { type: "env", names: ["OPENROUTER_API_KEY"] }], connections: [{ id: "c1" }] },
    { id: "openai", name: "OpenAI", methods: [{ type: "key" }, { id: "chatgpt-token-sharing", type: "oauth", label: "Sign in with ChatGPT" }], connections: [] },
  ];
  const out = mapConnections(integrations);
  expect(out.map((c) => c.id)).toEqual(["opencode", "openai", "openrouter"]);
  expect(out.find((c) => c.id === "openai")).toEqual({ id: "openai", name: "Codex", connected: false, methods: ["key", "signin"], supportsFreeFilter: false });
  expect(out.find((c) => c.id === "openrouter")).toEqual({ id: "openrouter", name: "OpenRouter", connected: true, methods: ["key"], supportsFreeFilter: true });
  expect(out.find((c) => c.id === "opencode")?.methods).toEqual(["key"]);
  expect(out.map((c) => [c.id, c.supportsFreeFilter])).toEqual([["opencode", true], ["openai", false], ["openrouter", true]]);
});

test("disconnecting removes saved credentials by id; an env-only connection cannot be removed from the app", () => {
  expect(credentialIdsFor({ connections: [{ type: "credential", id: "cred_1" }, { type: "env", name: "OPENROUTER_API_KEY" }, { type: "credential", id: "cred_2" }] })).toEqual({ ids: ["cred_1", "cred_2"], envOnly: false });
  expect(credentialIdsFor({ connections: [{ type: "env", name: "OPENROUTER_API_KEY" }] })).toEqual({ ids: [], envOnly: true });
  expect(credentialIdsFor({ connections: [] })).toEqual({ ids: [], envOnly: false });
  expect(credentialIdsFor(undefined)).toEqual({ ids: [], envOnly: false });
});

test("the assistant is told its one tool and that memory is automatic", () => {
  expect(AGENT_SYSTEM).toContain("only tool is web search");
  expect(AGENT_SYSTEM).toContain("remember");
});

// Real opencode against a local mock model server: no network, no account. Skipped when opencode isn't installed.
test.skipIf(!Bun.which("opencode"))("opencode end to end on a mock OpenRouter: connect, answer with one tool-free-ish prompt, title on the chosen model, disconnect", async () => {
  const calls: { tools: string[]; system: string; last: string }[] = [];
  const mock = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (!u.pathname.endsWith("/chat/completions")) return new Response("{}", { headers: { "content-type": "application/json" } });
      const body = (await req.json()) as any;
      calls.push({ tools: (body.tools ?? []).map((t: any) => t.function?.name), system: String(body.messages?.[0]?.content ?? ""), last: String(body.messages?.at(-1)?.content ?? "") });
      const isTitle = /name chats/i.test(String(body.messages?.at(-1)?.content ?? "")) || /name chats/i.test(JSON.stringify(body.messages));
      const chunk = (d: unknown, fin?: string) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: d, finish_reason: fin ?? null }] })}\n\n`;
      return new Response(chunk({ role: "assistant", content: isTitle ? "Greeting Chat." : "pong" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  const eng = await createOpencodeEngine({
    dataDir: mkdtempSync(join(tmpdir(), "zero-mock-")),
    config: { providers: { openrouter: { settings: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "x" } } } },
  });
  try {
    expect((await eng.listConnections()).find((c) => c.id === "openrouter")?.connected).toBe(false);
    await eng.setProviderKey("openrouter", "sk-test");
    expect((await eng.listConnections()).find((c) => c.id === "openrouter")?.connected).toBe(true);
    const or = (await eng.listProviders()).find((p) => p.id === "openrouter")!;
    expect(or.models.length).toBeGreaterThan(10);
    const model = { providerId: "openrouter", modelId: or.models[0].id };

    const sid = await eng.createSession(model);
    const evs = await collect(eng.prompt(args({ sessionId: sid, text: "hi", model })));
    expect(evs.map((e) => e.type)).toContain("delta");
    const answer = calls[0];
    expect(answer.tools).toEqual(expect.arrayContaining(["websearch"]));
    expect(answer.system).toContain("only tool is web search");

    const before = calls.length;
    const title = await eng.complete({ kind: "title", system: "You name chats so a person can find them.", text: "User: hi", model });
    expect(title).toContain("Greeting Chat");
    // Zero names chats itself, so the engine must not add a naming call of its own.
    expect(calls.length - before).toBe(1);

    await eng.removeProviderKey("openrouter");
    expect((await eng.listConnections()).find((c) => c.id === "openrouter")?.connected).toBe(false);
  } finally { eng.close(); mock.stop(); }
}, 90_000);

import { expect, test } from "bun:test";
import { FakeEngine } from "../src/engine/fake";
import { AGENT_SYSTEM, mapConnections, mapEvent, mapModels, parseServerBanner, separateAfterTools } from "../src/engine/opencode";
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

test("text written before and after a web search is kept apart by a blank line", () => {
  const run = (events: EngineEvent[]) => { const f = separateAfterTools(); return events.map(f).filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join(""); };
  const search: EngineEvent[] = [{ type: "status", state: "searching" }, { type: "source", title: "t", url: "https://x.test" }];
  expect(run([{ type: "delta", text: "I'll check." }, ...search, { type: "delta", text: "**Latest" }, { type: "delta", text: " stable**" }])).toBe("I'll check.\n\n**Latest stable**");
  expect(run([{ type: "delta", text: "Looking.\n" }, ...search, { type: "delta", text: "Done" }])).toBe("Looking.\n\nDone"); // tops up an existing line break
  expect(run([{ type: "delta", text: "Looking.\n\n" }, ...search, { type: "delta", text: "Done" }])).toBe("Looking.\n\nDone"); // never doubles it
  expect(run([...search, { type: "delta", text: "Answer" }])).toBe("Answer"); // nothing was said before the search
  expect(run([{ type: "delta", text: "a" }, { type: "delta", text: "b" }])).toBe("ab"); // no tool, no break
  expect(run([{ type: "delta", text: "a" }, ...search, { type: "delta", text: "b" }, ...search, { type: "delta", text: "c" }])).toBe("a\n\nb\n\nc");
});

test("mapEvent shows searching and sources for the web search tool", () => {
  expect(mapEvent("s1", { type: "session.tool.called", data: { sessionID: "s1", tool: "websearch", input: { query: "bun" } } })).toEqual([{ type: "status", state: "searching" }]);
  expect(
    mapEvent("s1", { type: "session.tool.success", data: { sessionID: "s1", tool: "websearch", structured: { results: [{ title: "Bun", url: "https://bun.sh" }] } } }),
  ).toEqual([{ type: "source", title: "Bun", url: "https://bun.sh" }]);
});

test("OpenCode 2.2's web search: the tool name arrives on input.started, the results as Markdown links", () => {
  const ctx: { tool?: string } = {};
  const ev = (type: string, data: object) => mapEvent("s1", { type, data: { sessionID: "s1", ...data } }, ctx);
  expect(ev("session.tool.input.started", { name: "websearch" })).toEqual([{ type: "status", state: "searching" }]);
  expect(ev("session.tool.called", { input: { query: "bun" }, executed: false })).toEqual([]); // already announced
  expect(ev("session.tool.progress", { metadata: { provider: "parallel" } })).toEqual([]);
  const md = "## [Releases · oven-sh/bun · GitHub](https://github.com/oven-sh/bun/releases)\n\nMore items [](github.com/oven-sh/bun)\n\n[Tags](github.com/oven-sh/bun/tags)\n\n## [Bun v1.4](https://bun.sh/blog/bun-v1.4)\n\ntext\n\n## [Releases · oven-sh/bun · GitHub](https://github.com/oven-sh/bun/releases)";
  expect(ev("session.tool.success", { content: [{ type: "text", text: md }], metadata: {} })).toEqual([
    { type: "source", title: "Releases · oven-sh/bun · GitHub", url: "https://github.com/oven-sh/bun/releases" },
    { type: "source", title: "Bun v1.4", url: "https://bun.sh/blog/bun-v1.4" },
  ]); // only full https headings, once each
  expect(ctx.tool).toBeUndefined(); // the call is over
});

test("another tool's events (notes) never show as searching or as sources", () => {
  const ctx: { tool?: string } = {};
  const ev = (type: string, data: object) => mapEvent("s1", { type, data: { sessionID: "s1", ...data } }, ctx);
  expect(ev("session.tool.input.started", { name: "koremind_save_note" })).toEqual([]);
  expect(ev("session.tool.called", { input: {}, executed: false })).toEqual([]);
  expect(ev("session.tool.success", { content: [{ type: "text", text: "## [Looks like a link](https://x.test)" }] })).toEqual([]);
});

test("a search result with no links, or more than eight, is handled", () => {
  const ctx: { tool?: string } = {};
  const ev = (type: string, data: object) => mapEvent("s1", { type, data: { sessionID: "s1", ...data } }, ctx);
  ev("session.tool.input.started", { name: "websearch" });
  expect(ev("session.tool.success", { content: [{ type: "text", text: "nothing useful here" }] })).toEqual([]);
  ev("session.tool.input.started", { name: "websearch" });
  const many = Array.from({ length: 12 }, (_, i) => `## [Page ${i}](https://e.test/${i})`).join("\n\n");
  expect(ev("session.tool.success", { content: [{ type: "text", text: many }] })).toHaveLength(8);
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

test.skipIf(!process.env.KOREMIND_LIVE)("live: opencode lists models and streams a reply (or reports the free limit)", async () => {
  const eng = await createOpencodeEngine({ dataDir: mkdtempSync(join(tmpdir(), "koremind-live-")) });
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
  const m = (id: string, extra: object) => ({ id, modelID: id, providerID: "opencode-go", name: id, capabilities: { input: ["text"] }, variants: [], enabled: true, status: "active", ...extra });
  const out = mapModels([{ id: "opencode-go", name: "OpenCode Go" }, { id: "other", name: "Other" }], [m("a:free", free), m("b", paid), m("c", mixed), m("d", {})], undefined, new Set(["opencode-go"]));
  const go = out.find((p) => p.id === "opencode-go")!;
  expect(go.models.map((x) => [x.id, x.free])).toEqual([["a:free", true], ["b", false], ["c", false], ["d", false]]);
  expect(go.status).toBe("ready");
  expect(out.find((p) => p.id === "other")).toMatchObject({ status: "needs_connection", connected: false, models: [] });
  // OpenCode's free tier works without a key.
  expect(mapModels([{ id: "opencode", name: "OpenCode" }], [], undefined, new Set())[0]).toMatchObject({ status: "ready", connected: false });
});

test("mapConnections offers only OpenCode and OpenCode Go, status only, with a server hint when Go is not signed in", () => {
  const integrations = [
    { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }], connections: [] },
    { id: "groq", name: "Groq", methods: [{ type: "key" }], connections: [{ id: "g" }] },
    { id: "opencode", name: "OpenCode", methods: [{ type: "key" }], connections: [] },
    { id: "opencode-go", name: "OpenCode Go", methods: [{ type: "key" }, { type: "env", names: ["OPENCODE_API_KEY"] }], connections: [] },
    { id: "openrouter", name: "OpenRouter", methods: [{ type: "key" }], connections: [{ id: "c1" }] },
    { id: "openai", name: "OpenAI", methods: [{ type: "oauth" }], connections: [] },
  ];
  const out = mapConnections(integrations);
  expect(out).toEqual([
    // The free tier needs no sign-in, so there is nothing to tell the owner.
    { id: "opencode", name: "OpenCode", connected: false, supportsFreeFilter: true, hint: "" },
    // OpenCode Go is a subscription: every model is paid for by the plan, so there is no free filter.
    { id: "opencode-go", name: "OpenCode Go", connected: false, supportsFreeFilter: false, hint: "Run `opencode auth login` on the server." },
  ]);
  const signedIn = mapConnections([{ id: "opencode-go", connections: [{ id: "c2" }] }]);
  expect(signedIn.find((c) => c.id === "opencode-go")).toMatchObject({ connected: true, hint: "" });
});

test("the assistant is told its tools and that memory is its own to manage", () => {
  expect(AGENT_SYSTEM).toContain("web search");
  for (const tool of ["save_note", "read_notes", "edit_note", "remember", "recall_memory", "update_memory", "forget_memory"]) expect(AGENT_SYSTEM).toContain(tool);
  expect(AGENT_SYSTEM).toContain("approve");
  expect(AGENT_SYSTEM).toContain("instead of guessing");
  expect(AGENT_SYSTEM).toContain("Never say you cannot remember");
});

test("notes are the assistant's own working space, used without being asked", () => {
  for (const part of ["working space", "without being asked", "multi-step", "read_notes"]) expect(AGENT_SYSTEM).toContain(part);
});

test("the assistant recalls before answering about the user, unless memory is off", () => {
  expect(AGENT_SYSTEM).toContain("recall_memory before");
  expect(AGENT_SYSTEM).toContain("unless memory is turned off");
});

test("recalling is bounded: once per lookup, and not when nothing is saved", () => {
  expect(AGENT_SYSTEM).toContain("do not repeat a lookup");
  expect(AGENT_SYSTEM).toContain("nothing is saved yet");
  expect(AGENT_SYSTEM).not.toContain("short profile at the start of a chat, with the details left out on purpose.");
});

test("notes are read back when needed, not on every turn", () => {
  expect(AGENT_SYSTEM).toContain("no longer in view");
  expect(AGENT_SYSTEM).not.toContain("read them back at the start of later turns");
});

/** A freshly started OpenCode loads its provider catalog for a moment; wait until OpenCode Go shows up signed in. */
const goReady = async (eng: { listProviders(): Promise<{ id: string; status: string; models: { id: string }[] }[]> }) => {
  for (let i = 0; i < 40; i++) {
    const go = (await eng.listProviders()).find((p) => p.id === "opencode-go");
    if (go?.status === "ready" && go.models.length) return go;
    await Bun.sleep(250);
  }
  throw new Error("OpenCode Go never became ready");
};

// Real opencode against a local mock model server: no network, no account. Skipped when opencode isn't installed.
test.skipIf(!Bun.which("opencode"))("opencode end to end on a mock OpenCode Go signed in through the server env: answer with one tool-free-ish prompt, title on the chosen model", async () => {
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
    dataDir: mkdtempSync(join(tmpdir(), "koremind-mock-")),
    env: { OPENCODE_API_KEY: "sk-test" },
    config: { providers: { "opencode-go": { settings: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "x" } } } },
  });
  try {
    const go = await goReady(eng);
    expect((await eng.listConnections()).find((c) => c.id === "opencode-go")).toMatchObject({ connected: true, hint: "" });
    const model = { providerId: "opencode-go", modelId: go.models[0].id };

    const sid = await eng.createSession(model);
    const evs = await collect(eng.prompt(args({ sessionId: sid, text: "hi", model })));
    expect(evs.map((e) => e.type)).toContain("delta");
    const answer = calls[0];
    expect(answer.tools).toEqual(expect.arrayContaining(["websearch"]));
    expect(answer.system).toContain("save_note");

    const before = calls.length;
    const title = await eng.complete({ kind: "title", system: "You name chats so a person can find them.", text: "User: hi", model });
    expect(title).toContain("Greeting Chat");
    // KoreMind names chats itself, so the engine must not add a naming call of its own.
    expect(calls.length - before).toBe(1);
  } finally { eng.close(); mock.stop(); }
}, 90_000);

// The whole chain with nothing faked but the model: OpenCode -> KoreMind's /mcp -> notes -> approval card -> back to the model.
test.skipIf(!Bun.which("opencode"))("a model saves a note through OpenCode and KoreMind's MCP endpoint, and asks approval to read another chat", async () => {
  const { createApp } = await import("../src/http");
  const { createServices } = await import("../src/services");
  const { openDb } = await import("../src/db");
  const { addUser } = await import("./helpers");
  type Call = { tools: string[]; last: string };
  const calls: Call[] = [];
  let step = 0;
  const toolCall = (name: string, args: object) => {
    const chunk = (d: unknown, fin?: string) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: d, finish_reason: fin ?? null }] })}\n\n`;
    return chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${step}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }) + chunk({}, "tool_calls") + "data: [DONE]\n\n";
  };
  const text = (t: string) => {
    const chunk = (d: unknown, fin?: string) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: d, finish_reason: fin ?? null }] })}\n\n`;
    return chunk({ role: "assistant", content: t }) + chunk({}, "stop") + "data: [DONE]\n\n";
  };
  const script: ((c: Call) => string)[] = [
    (c) => toolCall(c.tools.find((n) => n.endsWith("save_note"))!, { title: "Milk", body: "2 litres" }),
    () => toolCall("koremind_read_notes", { chat: "Lisbon trip" }),
    () => text("Noted, and I looked at your Lisbon notes."),
  ];
  const mock = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (!u.pathname.endsWith("/chat/completions")) return new Response("{}", { headers: { "content-type": "application/json" } });
      const body = (await req.json()) as any;
      const last = JSON.stringify(body.messages.at(-1)).slice(0, 400);
      const c = { tools: (body.tools ?? []).map((t: any) => t.function?.name), last };
      if (/name chats/i.test(JSON.stringify(body.messages))) return new Response(text("A title"), { headers: { "content-type": "text/event-stream" } });
      calls.push(c);
      return new Response((script[step++] ?? (() => text("done")))(c), { headers: { "content-type": "text/event-stream" } });
    },
  });
  let app!: ReturnType<typeof createApp>;
  const secret = "e2e-secret";
  const koremind = Bun.serve({ port: 0, fetch: (req, srv) => app.fetch(req, srv.requestIP(req)?.address) });
  const engine = await createOpencodeEngine({
    dataDir: mkdtempSync(join(tmpdir(), "koremind-e2e-")),
    env: { OPENCODE_API_KEY: "sk-test" },
    config: {
      providers: { "opencode-go": { settings: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "x" } } },
      mcp: { servers: { koremind: { type: "remote", url: `http://127.0.0.1:${koremind.port}/mcp`, oauth: false, codemode: false, headers: { authorization: `Bearer ${secret}` }, timeout: { execution: 60000 } } } },
    },
  });
  try {
    const services = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "koremind-e2e-d-")), engine, version: "t", mcpSecret: secret, approvalTimeoutMs: 20_000 });
    app = createApp(services);
    const model = { providerId: "opencode-go", modelId: (await goReady(engine)).models[0].id };
    const owner = addUser(services.db, "me@home.lan", { owner: true, sub: "sub-owner" });
    const u = owner.id;
    const other = services.chats.create(u);
    services.chats.rename(u, other.id, "Lisbon trip");
    await services.notes.save({ userId: u, chatId: other.id }, { title: "Hotel", body: "Alfama" });
    const here = services.chats.create(u);

    const evs: any[] = [];
    for await (const e of services.chats.send(u, here.id, { text: "note that I need milk, then check my Lisbon trip notes", attachmentIds: [], model }, new AbortController().signal)) {
      evs.push(e);
      if (e.type === "approval") services.approvals.answer(u, here.id, e.id, true);
    }
    expect(calls[0].tools.some((n) => n.endsWith("save_note"))).toBe(true);
    expect(calls[0].tools.filter((n) => /note/.test(n)).sort()).toEqual(["koremind_edit_note", "koremind_read_notes", "koremind_save_note"]);
    expect(evs.map((e) => e.type)).toEqual(expect.arrayContaining(["activity", "approval", "approval_closed", "delta", "done"]));
    expect(evs.filter((e) => e.type === "activity").map((e) => [e.kind, e.chat ?? null])).toEqual([["saved", null], ["read", "Lisbon trip"]]);
    expect((await services.notes.read({ userId: u, chatId: here.id }, {})).text).toContain("2 litres");
    // the model was given the other chat's notes only after approval
    expect(calls[2].last).toContain("Alfama");
    expect(services.chats.get(u, here.id)!.messages.at(-1)!.activity).toHaveLength(2);
  } finally { engine.close(); mock.stop(); koremind.stop(); }
}, 120_000);

test("the assistant's style rules (tuned against DeepSeek V4.1 Flash at High) are in its prompt", () => {
  for (const rule of [
    "lead with the answer or the artefact",
    "Reply in the language the user writes in",
    "never invent versions, flags, prices or facts",
    "do not announce that you are about to search",
    "give the complete file, not a patch",
    "Do not pad",
    "never invent traits or details about them",
    "a greeting or a casual remark gets a sentence or two of plain prose, never a list",
  ]) expect(AGENT_SYSTEM).toContain(rule);
  for (const gone of ["no decoration", "Use Markdown only where it helps reading"]) expect(AGENT_SYSTEM).not.toContain(gone);
});

test("the assistant knows every block the clients draw and is invited to use them", () => {
  for (const block of ["headings", "numbered lists", "tables", "code blocks", "quotes", "links", "images", "cards"]) expect(AGENT_SYSTEM).toContain(block);
  expect(AGENT_SYSTEM).toContain("without waiting to be asked");
});

test("the assistant knows the card format and when not to use it", () => {
  for (const part of ["a fenced block tagged card", "\"type\": \"stats\"", "\"type\": \"table\"", "\"type\": \"bars\"", "\"type\": \"note\"", "Valid JSON only", "at most two per reply", "never for a single fact", "A plain comparison is a Markdown table, not a card", "never invent one"]) expect(AGENT_SYSTEM).toContain(part);
});

import { expect, test } from "bun:test";
import { FakeEngine } from "../src/engine/fake";
import { mapEvent, mapModels, parseServerBanner } from "../src/engine/opencode";
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

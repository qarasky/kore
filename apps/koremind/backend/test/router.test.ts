import { expect, test } from "bun:test";
import type { ProviderInfo } from "@koremind/shared";
import { FakeEngine } from "../src/engine/fake";
import { createRouter } from "../src/engine/router";
import type { EngineEvent, PromptArgs } from "../src/engine/types";

const prov = (id: string): ProviderInfo => ({ id, name: id, recommended: false, connected: true, status: "ready", models: [{ id: `${id}-m`, name: "M", vision: false, thinkingLevels: [], isDefault: true, free: false }] });
const collect = async (it: AsyncIterable<EngineEvent>) => { const out: EngineEvent[] = []; for await (const e of it) out.push(e); return out; };
const args = (o: Partial<PromptArgs>): PromptArgs => ({ sessionId: "s", system: "", text: "hi", files: [], model: { providerId: "a", modelId: "a-m" }, signal: new AbortController().signal, ...o });

const setup = () => {
  const claude = new FakeEngine({ providers: [prov("claude")], reply: () => [{ type: "delta", text: "from claude" }], titleReply: "claude title" });
  const oc = new FakeEngine({ providers: [prov("opencode"), prov("opencode-go"), prov("hidden")], reply: () => [{ type: "delta", text: "from opencode" }], titleReply: "oc title" });
  const router = createRouter([{ providers: ["claude"], engine: claude }, { providers: ["opencode-go", "opencode"], engine: oc }], { titleModel: { providerId: "claude", modelId: "claude-haiku-5-5" } });
  return { claude, oc, router };
};

test("provider lists are filtered to each route's providers and come in route order", async () => {
  const { router } = setup();
  expect((await router.listProviders()).map((p) => p.id)).toEqual(["claude", "opencode", "opencode-go"]);
  expect((await router.listConnections()).map((c) => c.id)).toEqual(["claude", "opencode", "opencode-go"]);
});

test("sessions, prompts and deletes go to the provider's engine", async () => {
  const { router, claude, oc } = setup();
  const s1 = await router.createSession({ providerId: "opencode", modelId: "opencode-m" });
  expect(oc.sessions.has(s1)).toBe(true);
  expect(claude.sessions.size).toBe(0);
  const evs = await collect(router.prompt(args({ sessionId: s1, model: { providerId: "opencode", modelId: "opencode-m" } })));
  expect(evs).toContainEqual({ type: "delta", text: "from opencode" });
  const s2 = await router.createSession({ providerId: "claude", modelId: "claude-m" });
  expect(claude.sessions.has(s2)).toBe(true);
  await router.deleteSession(s1);
  expect(oc.sessions.has(s1)).toBe(false);
  expect(claude.sessions.has(s2)).toBe(true);
});

test("no model means the first route", async () => {
  const { router, claude } = setup();
  const s = await router.createSession();
  expect(claude.sessions.has(s)).toBe(true);
});

test("a provider with no route gets a noProvider error instead of a crash", async () => {
  const { router } = setup();
  const evs = await collect(router.prompt(args({ model: { providerId: "groq", modelId: "x" } })));
  expect(evs).toEqual([{ type: "error", message: "That provider isn't enabled on this server.", noProvider: true }]);
});

test("Claude chats are titled on the title model; other providers' chats on their own model (Claude stays owner-only)", async () => {
  const { router, claude, oc } = setup();
  expect(await router.complete({ kind: "title", system: "", text: "t", model: { providerId: "claude", modelId: "claude-sonnet-5-5" } })).toBe("claude title");
  expect(claude.completes.at(-1)!.model).toEqual({ providerId: "claude", modelId: "claude-haiku-5-5" });
  expect(await router.complete({ kind: "title", system: "", text: "t", model: { providerId: "opencode", modelId: "opencode-m" } })).toBe("oc title");
  expect(oc.completes.at(-1)!.model).toEqual({ providerId: "opencode", modelId: "opencode-m" });
  expect(claude.completes).toHaveLength(1);
});

test("memory summaries run on the given model; an unrouted provider throws so memory can fall back", async () => {
  const { router, oc } = setup();
  await router.complete({ kind: "memory", system: "", text: "t", model: { providerId: "opencode-go", modelId: "opencode-go-m" } });
  expect(oc.completes.at(-1)!.model).toEqual({ providerId: "opencode-go", modelId: "opencode-go-m" });
  await expect(router.complete({ kind: "memory", system: "", text: "t", model: { providerId: "groq", modelId: "x" } })).rejects.toThrow("provider not enabled: groq");
});

test("one engine failing to list still shows the other's providers", async () => {
  const broken = new FakeEngine();
  broken.listProviders = async () => { throw new Error("down"); };
  broken.listConnections = async () => { throw new Error("down"); };
  const ok = new FakeEngine({ providers: [prov("claude")] });
  const router = createRouter([{ providers: ["opencode"], engine: broken }, { providers: ["claude"], engine: ok }]);
  const orig = console.error; console.error = () => {};
  try {
    expect((await router.listProviders()).map((p) => p.id)).toEqual(["claude"]);
    expect((await router.listConnections()).map((c) => c.id)).toEqual(["claude"]);
  } finally { console.error = orig; }
});

test("close closes every engine", () => {
  const { router, claude, oc } = setup();
  let closed = 0;
  claude.close = () => { closed++; };
  oc.close = () => { closed++; };
  router.close();
  expect(closed).toBe(2);
});

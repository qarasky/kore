import { expect, test } from "bun:test";
import { createMcp } from "../src/mcp";

const sess = "ses_abc";
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) });

function setup() {
  const calls: unknown[] = [];
  const mcp = createMcp({
    resolveSession: (s) => (s === sess ? { userId: "u1", chatId: "c1" } : null),
    notes: {
      save: async (ctx, a) => { calls.push(["save", ctx, a]); return { text: "Saved" }; },
      read: async (ctx, a) => { calls.push(["read", ctx, a]); return { text: "Notes" }; },
      edit: async (ctx, a) => { calls.push(["edit", ctx, a]); return { text: "Edited", isError: true }; },
    },
    memory: {
      remember: (ctx, a) => { calls.push(["remember", ctx, a]); return { text: "Remembered" }; },
      recall: (ctx, a) => { calls.push(["recall", ctx, a]); return { text: "Found" }; },
      update: (ctx, a) => { calls.push(["update", ctx, a]); return { text: "Updated" }; },
      forget: (ctx, a) => { calls.push(["forget", ctx, a]); return { text: "Forgot" }; },
    },
  });
  return { mcp, calls };
}

test("initialize, ping and the initialized notification follow the protocol", async () => {
  const { mcp } = setup();
  const init = await mcp.handle(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  expect(init.status).toBe(200);
  expect((init.body as any).result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "koremind" } });
  expect((await mcp.handle(rpc("notifications/initialized", undefined, null))).status).toBe(202);
  expect((await mcp.handle(rpc("ping"))).body).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
});

test("tools/list names the note and memory tools with JSON schemas", async () => {
  const { mcp } = setup();
  const r = (await mcp.handle(rpc("tools/list"))).body as any;
  expect(r.result.tools.map((t: any) => t.name)).toEqual(["save_note", "read_notes", "edit_note", "remember", "recall_memory", "update_memory", "forget_memory"]);
  for (const t of r.result.tools) { expect(t.description.length).toBeGreaterThan(20); expect(t.inputSchema.type).toBe("object"); }
  expect(r.result.tools[0].inputSchema.required).toEqual(["title", "body"]);
  expect(r.result.tools[2].inputSchema.required).toEqual(["id"]);
});

test("tools/call maps the OpenCode session to its chat and returns text content", async () => {
  const { mcp, calls } = setup();
  const r = (await mcp.handle(rpc("tools/call", { name: "save_note", arguments: { title: "T", body: "B" }, _meta: { "ai.opencode/sessionID": sess } }))).body as any;
  expect(r.result).toEqual({ content: [{ type: "text", text: "Saved" }] });
  expect(calls[0]).toEqual(["save", { userId: "u1", chatId: "c1" }, { title: "T", body: "B" }]);
  const e = (await mcp.handle(rpc("tools/call", { name: "edit_note", arguments: { id: "n" }, _meta: { "ai.opencode/sessionID": sess } }))).body as any;
  expect(e.result.isError).toBe(true);
});

test("a call without a known session, with bad arguments, or for an unknown tool is an error result, not a crash", async () => {
  const { mcp, calls } = setup();
  const noSession = (await mcp.handle(rpc("tools/call", { name: "read_notes", arguments: {} }))).body as any;
  expect(noSession.result.isError).toBe(true);
  const unknownSession = (await mcp.handle(rpc("tools/call", { name: "read_notes", arguments: {}, _meta: { "ai.opencode/sessionID": "ses_other" } }))).body as any;
  expect(unknownSession.result.isError).toBe(true);
  const badArgs = (await mcp.handle(rpc("tools/call", { name: "save_note", arguments: { title: 5 }, _meta: { "ai.opencode/sessionID": sess } }))).body as any;
  expect(badArgs.result.isError).toBe(true);
  const unknownTool = (await mcp.handle(rpc("tools/call", { name: "rm_rf", arguments: {}, _meta: { "ai.opencode/sessionID": sess } }))).body as any;
  expect(unknownTool.error?.code ?? (unknownTool.result?.isError ? -1 : 0)).not.toBe(0);
  expect(calls).toHaveLength(0);
  expect(((await mcp.handle({ nonsense: true })).body as any).error.code).toBe(-32600);
  expect(((await mcp.handle(rpc("resources/list"))).body as any).error.code).toBe(-32601);
});

test("memory tools reach the memory store with the session's user and chat", async () => {
  const { mcp, calls } = setup();
  const meta = { "ai.opencode/sessionID": sess };
  expect(((await mcp.handle(rpc("tools/call", { name: "remember", arguments: { text: "Likes tea" }, _meta: meta }))).body as any).result.content[0].text).toBe("Remembered");
  await mcp.handle(rpc("tools/call", { name: "recall_memory", arguments: {}, _meta: meta }));
  await mcp.handle(rpc("tools/call", { name: "recall_memory", arguments: { query: "tea" }, _meta: meta }));
  await mcp.handle(rpc("tools/call", { name: "update_memory", arguments: { id: "a1", text: "Loves tea" }, _meta: meta }));
  await mcp.handle(rpc("tools/call", { name: "forget_memory", arguments: { id: "a1" }, _meta: meta }));
  const ctx = { userId: "u1", chatId: "c1" };
  expect(calls).toEqual([["remember", ctx, { text: "Likes tea" }], ["recall", ctx, {}], ["recall", ctx, { query: "tea" }], ["update", ctx, { id: "a1", text: "Loves tea" }], ["forget", ctx, { id: "a1" }]]);
  const bad = (await mcp.handle(rpc("tools/call", { name: "update_memory", arguments: { id: "a1" }, _meta: meta }))).body as any;
  expect(bad.result.isError).toBe(true);
});

test("a tools/call without _meta uses the header session (Claude sends the chat that way)", async () => {
  const { mcp, calls } = setup();
  const r = await mcp.handle(rpc("tools/call", { name: "save_note", arguments: { title: "Milk", body: "2 l" } }), sess);
  expect((r.body as any).result.content[0].text).toBe("Saved");
  expect(calls).toEqual([["save", { userId: "u1", chatId: "c1" }, { title: "Milk", body: "2 l" }]]);
  const none = await mcp.handle(rpc("tools/call", { name: "save_note", arguments: { title: "a", body: "b" } }));
  expect((none.body as any).result.isError).toBe(true);
});

test("_meta wins over the header", async () => {
  const { mcp, calls } = setup();
  const r = await mcp.handle(rpc("tools/call", { name: "read_notes", arguments: {}, _meta: { "ai.opencode/sessionID": "ses_unknown" } }), sess);
  expect((r.body as any).result.isError).toBe(true);
  expect(calls).toEqual([]);
});

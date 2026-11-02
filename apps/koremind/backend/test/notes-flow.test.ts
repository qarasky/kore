import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StreamEvent } from "@zero/shared";
import { createApp } from "../src/http";
import { createServices } from "../src/services";
import { openDb } from "../src/db";
import { FakeEngine } from "../src/engine/fake";

const model = { providerId: "opencode", modelId: "fast" };
const SECRET = "test-secret";
const mcpCall = (services: ReturnType<typeof createServices>, sessionId: string, name: string, args: object) =>
  services.mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { "ai.opencode/sessionID": sessionId } } });
const textOf = (r: { body: unknown }) => ((r.body as any).result.content[0].text as string);

async function world(during: (services: ReturnType<typeof createServices>, sessionId: string) => Promise<void>, approvalTimeoutMs?: number) {
  let services!: ReturnType<typeof createServices>;
  const engine = new FakeEngine({ reply: () => [{ type: "delta", text: "All done" }], during: (a) => during(services, a.sessionId) });
  services = createServices({ db: openDb(":memory:"), dataDir: mkdtempSync(join(tmpdir(), "zero-nf-")), engine, version: "t", mcpSecret: SECRET, approvalTimeoutMs });
  const owner = await services.auth.register({ email: "me@home.lan", password: "correct horse" });
  const u = owner.user.id;
  const other = services.chats.create(u);
  services.chats.rename(u, other.id, "Lisbon trip");
  await services.notes.save({ userId: u, chatId: other.id }, { title: "Hotel", body: "Alfama" });
  const here = services.chats.create(u);
  return { services, u, here, other, token: owner.token };
}
const run = async (services: ReturnType<typeof createServices>, u: string, chatId: string, onEvent: (e: StreamEvent) => void) => {
  const evs: StreamEvent[] = [];
  for await (const e of services.chats.send(u, chatId, { text: "check my Lisbon notes", attachmentIds: [], model }, new AbortController().signal)) { evs.push(e); onEvent(e); }
  return evs;
};

test("a model reading another chat's notes: card appears mid-turn, the user allows, notes flow back, activity is stored", async () => {
  let result = "";
  const { services, u, here } = await world(async (s, sid) => { result = textOf(await mcpCall(s, sid, "read_notes", { chat: "Lisbon trip" })); });
  const evs = await run(services, u, here.id, (e) => { if (e.type === "approval") services.approvals.answer(u, here.id, e.id, true); });
  expect(evs.map((e) => e.type)).toEqual(["status", "approval", "approval_closed", "activity", "delta", "done"]);
  expect(evs[1]).toMatchObject({ type: "approval", action: "read", chat: "Lisbon trip" });
  expect(evs[2]).toMatchObject({ type: "approval_closed", outcome: "allowed" });
  expect(evs[3]).toEqual({ type: "activity", kind: "read", title: "notes", chat: "Lisbon trip" });
  expect(result).toContain("Alfama");
  const msg = services.chats.get(u, here.id)!.messages.at(-1)!;
  expect(msg.text).toBe("All done");
  expect(msg.activity).toEqual([{ kind: "read", title: "notes", chat: "Lisbon trip" }]);
});

test("denying gives the model an error, records the refusal and the turn still finishes", async () => {
  let result: { isError?: boolean; text: string } = { text: "" };
  const { services, u, here } = await world(async (s, sid) => { const r = await mcpCall(s, sid, "read_notes", { chat: "Lisbon trip" }); result = { isError: (r.body as any).result.isError, text: textOf(r) }; });
  const evs = await run(services, u, here.id, (e) => { if (e.type === "approval") services.approvals.answer(u, here.id, e.id, false); });
  expect(evs.at(-1)!.type).toBe("done");
  expect(result.isError).toBe(true);
  expect(result.text).not.toContain("Alfama");
  expect(services.chats.get(u, here.id)!.messages.at(-1)!.activity).toEqual([{ kind: "denied", title: "notes", chat: "Lisbon trip" }]);
});

test("saving a note in the current chat needs no approval and shows up as activity", async () => {
  const { services, u, here } = await world(async (s, sid) => { await mcpCall(s, sid, "save_note", { title: "Todo", body: "buy milk" }); });
  const evs = await run(services, u, here.id, () => {});
  expect(evs.map((e) => e.type)).toEqual(["status", "activity", "delta", "done"]);
  expect(evs[1]).toEqual({ type: "activity", kind: "saved", title: "Todo" });
  expect((await services.notes.read({ userId: u, chatId: here.id }, {})).text).toContain("buy milk");
});

test("an approval nobody answers expires on its own: the card closes, the model gets an error, the turn finishes", async () => {
  let body: any;
  const { services, u, here } = await world(async (s, sid) => { body = (await mcpCall(s, sid, "read_notes", { chat: "Lisbon trip" })).body; }, 40);
  const evs = await run(services, u, here.id, () => {});
  expect(evs.map((e) => e.type)).toEqual(["status", "approval", "approval_closed", "activity", "delta", "done"]);
  expect(evs[2]).toMatchObject({ outcome: "expired" });
  expect(evs[3]).toMatchObject({ kind: "denied", chat: "Lisbon trip" });
  expect(body.result.isError).toBe(true);
});

test("HTTP: only the local engine with the secret may use /mcp; the approvals route answers a pending card", async () => {
  const { services, u, here, token } = await world(async () => {});
  const app = createApp(services, { trustProxy: false });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}, socketIp?: string) =>
    app.fetch(new Request("http://zero.test" + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), socketIp);
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  expect((await post("/mcp", ping, {}, "127.0.0.1")).status).toBe(401);
  expect((await post("/mcp", ping, { authorization: "Bearer wrong" }, "127.0.0.1")).status).toBe(401);
  expect((await post("/mcp", ping, { authorization: `Bearer ${SECRET}` }, "192.168.1.50")).status).toBe(403);
  expect((await post("/mcp", ping, { authorization: `Bearer ${SECRET}` }, "127.0.0.1")).status).toBe(200);
  expect((await post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, { authorization: `Bearer ${SECRET}` }, "127.0.0.1")).status).toBe(202);

  expect((await post(`/chats/${here.id}/approvals/nope`, { allow: true }, { authorization: `Bearer ${token}` })).status).toBe(404);
  expect((await post(`/chats/${here.id}/approvals/nope`, { allow: true })).status).toBe(401);
  void u;
});

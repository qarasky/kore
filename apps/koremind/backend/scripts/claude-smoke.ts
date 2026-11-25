// Live check of the Claude engine against the real `claude` CLI on this machine (uses its login; a few small Haiku prompts).
// Run from the repo root: bun backend/scripts/claude-smoke.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createClaudeEngine } from "../src/engine/claude";
import type { EngineEvent } from "../src/engine/types";
import { createMcp } from "../src/mcp";

const MODEL = { providerId: "claude", modelId: "claude-haiku-5-5" };
const secret = "smoke-secret";
const toolCalls: string[] = [];
const mcp = createMcp({
  resolveSession: (s) => ({ userId: "u", chatId: s }),
  notes: {
    save: async (_c, a) => { toolCalls.push(`save_note:${a.title}`); return { text: "Saved." }; },
    read: async () => { toolCalls.push("read_notes"); return { text: "No notes yet." }; },
    edit: async () => ({ text: "Edited." }),
  },
});
const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("no", { status: 401 });
    if (req.method !== "POST") return new Response(null, { status: req.method === "DELETE" ? 200 : 405 });
    const r = await mcp.handle(await req.json(), req.headers.get("x-koremind-session") ?? undefined);
    return r.body === undefined ? new Response(null, { status: r.status }) : Response.json(r.body, { status: r.status });
  },
});
const engine = createClaudeEngine({ bin: process.env.KOREMIND_CLAUDE_BIN ?? "claude", dataDir: mkdtempSync(join(tmpdir(), "koremind-smoke-")), mcpUrl: `http://127.0.0.1:${server.port}/mcp`, mcpSecret: secret });

/** A tiny solid red PNG, built here so the repo needs no binary fixture. */
function redPng(): string {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const w = 32, h = 32, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([255, 0, 0]))])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`); };
async function ask(sessionId: string, text: string, extra: { files?: { name: string; mime: string; dataUrl: string }[]; thinking?: string } = {}) {
  const evs: EngineEvent[] = [];
  const t0 = Date.now();
  for await (const e of engine.prompt({ sessionId, system: "", text, files: extra.files ?? [], model: MODEL, thinking: extra.thinking, signal: new AbortController().signal })) evs.push(e);
  const text_ = evs.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("");
  const err = evs.find((e) => e.type === "error") as { message: string } | undefined;
  return { evs, text: text_, err: err?.message, ms: Date.now() - t0, done: evs.at(-1)?.type === "done" };
}

try {
  const [p] = await engine.listProviders();
  check("signed in", p.status === "ready", p.status);

  const s = await engine.createSession(MODEL);
  const a = await ask(s, "Reply with the single word pong.");
  check("(a) reply", a.done && /pong/i.test(a.text), `${a.ms} ms, ${JSON.stringify(a.text.slice(0, 60))}${a.err ? ` err=${a.err}` : ""}`);
  const b = await ask(s, "What single word did you just reply with? Answer with just that word.");
  check("(b) resume keeps the conversation", b.done && /pong/i.test(b.text), JSON.stringify(b.text.slice(0, 60)));

  const c = await ask(await engine.createSession(MODEL), "Search the web: what is the latest stable version of Bun? One sentence.");
  const sources = c.evs.filter((e) => e.type === "source");
  check("(c) web search gives sources", c.done && c.evs.some((e) => e.type === "status" && e.state === "searching") && sources.length > 0, `${sources.length} sources, ${c.ms} ms`);
  check("(c) no own Sources list", !/^\s*(sources|источники)\s*:/im.test(c.text), JSON.stringify(c.text.slice(-120)));

  const d = await ask(await engine.createSession(MODEL), "Save a note titled Test with the body hello. Then say done.");
  check("(d) notes tool through MCP", toolCalls.includes("save_note:Test"), `${toolCalls.join(",") || "no tool calls"}${d.err ? ` err=${d.err}` : ""}`);

  const e = await ask(await engine.createSession(MODEL), "What colour is this image? One word.", { files: [{ name: "red.png", mime: "image/png", dataUrl: `data:image/png;base64,${redPng()}` }] });
  check("(e) image attachment", e.done && /red/i.test(e.text), JSON.stringify(e.text.slice(0, 60)) + (e.err ? ` err=${e.err}` : ""));

  const t0 = Date.now();
  const title = await engine.complete({ kind: "title", system: "You name chats. Reply with a title of at most five words and nothing else.", text: "User: plan a week in Lisbon\nAssistant: Sure.", model: MODEL }).catch((x) => `ERR ${x.message}`);
  check("(f) complete() for a title", !!title && !title.startsWith("ERR"), `${Date.now() - t0} ms, ${JSON.stringify(title)}`);

  const g = await ask(await engine.createSession(MODEL), "Reply with ok.", { thinking: "low" });
  check("(g) --effort low on Haiku", g.done, g.err ?? "accepted");

  const shell = await ask(await engine.createSession(MODEL), "Run the shell command `uname -a` and tell me the output. If you can't run commands, say exactly: NO SHELL.");
  check("(h) no shell access", !/Linux \S+ \d/.test(shell.text), JSON.stringify(shell.text.slice(0, 100)));
} finally {
  engine.close();
  server.stop();
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed ? `${failed} check(s) failed` : "all checks passed");
  process.exit(failed ? 1 : 0);
}

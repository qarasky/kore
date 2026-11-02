import { expect, test } from "bun:test";
import { parseStream } from "../lib/stream";

const body = (chunks: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } });
const all = async (s: ReadableStream<Uint8Array>) => { const o = []; for await (const e of parseStream(s)) o.push(e); return o; };

test("parseStream handles an event split across chunks", async () => {
  const evs = await all(body(['data: {"type":"del', 'ta","text":"hi"}\n', '\ndata: {"type":"done","messageId":"m"}\n\n']));
  expect(evs).toEqual([{ type: "delta", text: "hi" }, { type: "done", messageId: "m" }]);
});

test("parseStream yields error events", async () => {
  const evs = await all(body(['data: {"type":"error","code":"no_provider","message":"Connect"}\n\n']));
  expect(evs[0]).toEqual({ type: "error", code: "no_provider", message: "Connect" });
});

test("parseStream skips comments and malformed frames", async () => {
  const evs = await all(body([': ping\n\n', 'data: {oops\n\n', 'data: {"type":"delta","text":"ok"}\n\n']));
  expect(evs).toEqual([{ type: "delta", text: "ok" }]);
});

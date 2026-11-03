// Measures request -> first stream frame and first delta against a running backend.
// Usage: bun run backend/scripts/latency.ts [baseUrl]   (creates/logs into latency@koremind.local)
const base = process.argv[2] ?? "http://127.0.0.1:8787";
const creds = { email: "latency@koremind.local", password: "latency-test-password" };
const j = async (path: string, init: RequestInit = {}, token?: string) => {
  const r = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  return r;
};
let r = await j("/auth/register", { method: "POST", body: JSON.stringify(creds) });
if (!r.ok) r = await j("/auth/login", { method: "POST", body: JSON.stringify(creds) });
const { token } = (await r.json()) as { token: string };

const t0 = performance.now();
await j("/health");
const rtt = performance.now() - t0;

const models = (await (await j("/models", {}, token)).json()) as { id: string; models: { id: string; isDefault: boolean }[] }[];
const provider = models[0], model = provider.models.find((m) => m.isDefault)!;
const chat = (await (await j("/chats", { method: "POST" }, token)).json()) as { id: string };
const start = performance.now();
const res = await j(`/chats/${chat.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Reply with the single word pong", attachmentIds: [], model: { providerId: provider.id, modelId: model.id } }) }, token);
let firstFrame = 0, firstDelta = 0, buf = "";
const dec = new TextDecoder();
for await (const chunk of res.body as any) {
  buf += dec.decode(chunk, { stream: true });
  let i: number;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const ev = JSON.parse(buf.slice(0, i).replace(/^data: /, "")); buf = buf.slice(i + 2);
    const t = performance.now() - start;
    if (!firstFrame) firstFrame = t;
    if (ev.type === "delta" && !firstDelta) firstDelta = t;
    if (ev.type === "error") console.log("stream error:", ev.code, ev.message);
  }
}
console.log(JSON.stringify({ healthRttMs: Math.round(rtt), firstFrameMs: Math.round(firstFrame), firstDeltaMs: Math.round(firstDelta) || null }));

// Spike v2: talk to the installed `opencode serve` (v2 API) over raw HTTP in an isolated data dir.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = mkdtempSync(join(tmpdir(), "zero-spike-"));
const env = {
  ...process.env,
  XDG_DATA_HOME: join(base, "data"), XDG_CONFIG_HOME: join(base, "config"),
  XDG_STATE_HOME: join(base, "state"), XDG_CACHE_HOME: join(base, "cache"),
  OPENCODE_CONFIG_CONTENT: process.env.SPIKE_CONFIG ?? "{}",
};
const proc = Bun.spawn(["opencode", "serve", "--hostname=127.0.0.1", "--port=0"], { env, stdout: "pipe", stderr: "pipe" });
let url = "", pw = "", buf = "";
for await (const chunk of proc.stdout as any) {
  buf += new TextDecoder().decode(chunk);
  url = buf.match(/listening on (http:\/\/\S+)/)?.[1] ?? "";
  pw = buf.match(/server password (\S+)/)?.[1] ?? "";
  if (url && pw) break;
}
const auth = "Basic " + btoa("opencode:" + pw);
const call = async (m: string, p: string, body?: unknown) => {
  const r = await fetch(url + p, { method: m, headers: { authorization: auth, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: t }; }
};
const model = process.env.SPIKE_MODEL ?? "big-pickle";
const sess = await call("POST", "/api/session", { model: { id: model, providerID: "opencode" }, permissions: JSON.parse(process.env.SPIKE_PERMS ?? "null") ?? undefined });
const sid = sess.json.data.id;
console.log("session", sid, sess.status);
const evRes = await fetch(url + "/api/event", { headers: { authorization: auth } });
(async () => {
  const dec = new TextDecoder(); let b = "";
  for await (const c of evRes.body as any) {
    b += dec.decode(c); let i;
    while ((i = b.indexOf("\n\n")) >= 0) {
      const frame = b.slice(0, i); b = b.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
      const e = JSON.parse(line.slice(6));
      if (!/^(session|tool|websearch|permission)/.test(e.type) && !e.type.includes("session")) continue;
      if (e.type.endsWith("text.delta")) { process.stdout.write(e.data.delta ?? ""); continue; }
      console.log("\n[" + e.type + "]", JSON.stringify(e.data).slice(0, 300));
    }
  }
})();
await Bun.sleep(300);
const t0 = performance.now();
const pr = await call("POST", `/api/session/${sid}/prompt`, { text: process.env.SPIKE_Q ?? "Reply with the single word pong" });
console.log("prompt ack", Math.round(performance.now() - t0), "ms", pr.status, JSON.stringify(pr.json).slice(0, 200));
await Bun.sleep(Number(process.env.SPIKE_WAIT ?? 15000));
proc.kill(); process.exit(0);

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo, ProviderInfo } from "@zero/shared";
import type { Engine, EngineEvent, PromptArgs } from "./types";

// Talks to `opencode serve` (v2 API, see docs/superpowers/notes/engine-spike.md). No SDK: the published SDK targets an older server.

export function parseServerBanner(out: string): { url: string; password: string } | null {
  const url = out.match(/listening on (http:\/\/\S+)/)?.[1];
  const password = out.match(/server password (\S+)/)?.[1];
  return url && password ? { url, password } : null;
}

type Raw = { type: string; data?: any };

/** Maps one raw server event to engine events for the given engine session. Unknown events map to []. */
export function mapEvent(sessionId: string, raw: Raw): EngineEvent[] {
  const d = raw.data ?? {};
  if (d.sessionID !== sessionId) return [];
  switch (raw.type) {
    case "session.text.delta":
      return d.delta ? [{ type: "delta", text: String(d.delta) }] : [];
    case "session.execution.succeeded":
      return [{ type: "done" }];
    case "session.execution.failed": {
      const err = d.error ?? {};
      const noProvider = typeof err.type === "string" && err.type.startsWith("provider.free-limit");
      return [noProvider ? { type: "error", message: String(err.message ?? "Provider unavailable"), noProvider: true } : { type: "error", message: String(err.message ?? "Engine error") }];
    }
    case "session.tool.called":
    case "session.tool.started":
      return d.tool === "websearch" ? [{ type: "status", state: "searching" }] : [];
    case "session.tool.success": {
      const results = d.structured?.results;
      if (d.tool !== "websearch" || !Array.isArray(results)) return [];
      return results.filter((r: any) => r?.url).map((r: any) => ({ type: "source", title: String(r.title ?? r.url), url: String(r.url) }) as EngineEvent);
    }
    default:
      return [];
  }
}

export function mapModels(providers: { id: string; name: string }[], models: any[], defaultModelId?: string): ProviderInfo[] {
  return providers
    .map((p) => {
      const ms = models.filter((m) => m.providerID === p.id && m.enabled !== false && m.status !== "disabled");
      const defId = ms.find((m) => m.id === defaultModelId)?.id ?? ms[0]?.id;
      const out: ModelInfo[] = ms.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        vision: Array.isArray(m.capabilities?.input) && m.capabilities.input.includes("image"),
        thinkingLevels: (m.variants ?? []).map((v: any) => String(v.id ?? v)),
        isDefault: m.id === defId,
      }));
      return { id: p.id, name: p.name, connected: true, models: out };
    })
    .filter((p) => p.models.length > 0);
}

const AGENT_SYSTEM = "You are Zero, a concise, friendly personal assistant. Answer directly. Use web search only when you need current facts.";

export const zeroOpencodeConfig = {
  default_agent: "zero",
  websearch: { provider: "random" },
  warming: true,
  agents: {
    zero: {
      mode: "primary",
      system: AGENT_SYSTEM,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "websearch", resource: "*", effect: "allow" },
      ],
    },
  },
};

type Listener = (e: EngineEvent[]) => void;

export async function createOpencodeEngine(opts: { dataDir: string; bin?: string }): Promise<Engine> {
  const xdg = join(opts.dataDir, "opencode");
  for (const d of ["data", "config", "state", "cache"]) mkdirSync(join(xdg, d), { recursive: true });
  const proc = Bun.spawn([opts.bin ?? "opencode", "serve", "--hostname=127.0.0.1", "--port=0"], {
    env: {
      ...process.env,
      XDG_DATA_HOME: join(xdg, "data"), XDG_CONFIG_HOME: join(xdg, "config"),
      XDG_STATE_HOME: join(xdg, "state"), XDG_CACHE_HOME: join(xdg, "cache"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(zeroOpencodeConfig),
    },
    stdout: "pipe", stderr: "ignore",
  });
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let banner: ReturnType<typeof parseServerBanner> = null, buf = "";
  const deadline = Date.now() + 30_000;
  while (!banner) {
    if (Date.now() > deadline) { proc.kill(); throw new Error("opencode server did not start"); }
    const { value, done } = await reader.read();
    if (done) throw new Error("opencode server exited during startup");
    buf += dec.decode(value);
    banner = parseServerBanner(buf);
  }
  (async () => { while (!(await reader.read()).done); })();
  const { url } = banner;
  const auth = "Basic " + btoa("opencode:" + banner.password);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(url + path, { method, headers: { authorization: auth, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { ok: r.ok, status: r.status, json };
  };

  // One shared SSE stream, fanned out by session id. Reconnects on drop.
  const listeners = new Map<string, Set<(raw: Raw) => void>>();
  let closed = false;
  (async () => {
    while (!closed) {
      try {
        const res = await fetch(url + "/api/event", { headers: { authorization: auth } });
        let b = "";
        for await (const chunk of res.body as any) {
          b += dec.decode(chunk, { stream: true });
          let i: number;
          while ((i = b.indexOf("\n\n")) >= 0) {
            const frame = b.slice(0, i); b = b.slice(i + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let raw: Raw; try { raw = JSON.parse(line.slice(6)); } catch { continue; }
            const sid = raw.data?.sessionID;
            if (sid) listeners.get(sid)?.forEach((f) => f(raw));
          }
        }
      } catch { /* reconnect */ }
      if (!closed) await Bun.sleep(500);
    }
  })();

  const sessionModel = new Map<string, string>();
  const used = new Set<string>();
  let defaultModel: { providerId: string; modelId: string } | null = null;

  const listProviders = async (): Promise<ProviderInfo[]> => {
    const [p, m, d] = await Promise.all([call("GET", "/api/provider"), call("GET", "/api/model"), call("GET", "/api/model/default")]);
    const providers = (p.json?.data ?? []).filter((x: any) => x.id === "opencode").map((x: any) => ({ id: x.id, name: x.name }));
    const out = mapModels(providers, m.json?.data ?? [], d.json?.data?.id);
    const def = out[0]?.models.find((x) => x.isDefault);
    if (def) defaultModel = { providerId: out[0].id, modelId: def.id };
    return out;
  };

  const createSession = async (model?: { providerId: string; modelId: string }) => {
    const m = model ?? defaultModel ?? (await listProviders().then(() => defaultModel));
    const r = await call("POST", "/api/session", m ? { model: { id: m.modelId, providerID: m.providerId } } : {});
    if (!r.ok) throw new Error(`could not create engine session (${r.status})`);
    if (m) sessionModel.set(r.json.data.id, `${m.providerId}/${m.modelId}/`);
    return r.json.data.id as string;
  };

  async function* prompt(a: PromptArgs): AsyncIterable<EngineEvent> {
    const queue: EngineEvent[] = [];
    let wake: (() => void) | null = null;
    const set = listeners.get(a.sessionId) ?? new Set();
    listeners.set(a.sessionId, set);
    const onRaw = (raw: Raw) => { const evs = mapEvent(a.sessionId, raw); if (evs.length) { queue.push(...evs); wake?.(); } };
    set.add(onRaw);
    const onAbort = () => { call("POST", `/api/session/${a.sessionId}/interrupt`); wake?.(); };
    a.signal.addEventListener("abort", onAbort);
    try {
      yield { type: "status", state: "thinking" };
      const key = `${a.model.providerId}/${a.model.modelId}/${a.thinking ?? ""}`;
      if (sessionModel.get(a.sessionId) !== key) {
        await call("POST", `/api/session/${a.sessionId}/model`, { model: { id: a.model.modelId, providerID: a.model.providerId, ...(a.thinking ? { variant: a.thinking } : {}) } });
        sessionModel.set(a.sessionId, key);
      }
      const first = !used.has(a.sessionId);
      used.add(a.sessionId);
      const text = first && a.system ? `<context>\n${a.system}\n</context>\n\n${a.text}` : a.text;
      const r = await call("POST", `/api/session/${a.sessionId}/prompt`, { text, ...(a.files.length ? { files: a.files.map((f) => ({ uri: f.dataUrl, name: f.name })) } : {}) });
      if (!r.ok) { yield { type: "error", message: String(r.json?.message ?? `Engine rejected the prompt (${r.status})`) }; return; }
      while (!a.signal.aborted) {
        while (queue.length) {
          const ev = queue.shift()!;
          yield ev;
          if (ev.type === "done" || ev.type === "error") return;
        }
        await new Promise<void>((res) => { wake = res; setTimeout(res, 30_000); });
        wake = null;
      }
    } finally {
      set.delete(onRaw);
      a.signal.removeEventListener("abort", onAbort);
    }
  }

  return {
    listProviders,
    async setProviderKey(id, key) {
      const r = await call("POST", `/api/integration/${encodeURIComponent(id)}/connect/key`, { key });
      if (!r.ok) throw new Error(`could not connect provider (${r.status})`);
    },
    async removeProviderKey(id) { await call("DELETE", `/api/integration/${encodeURIComponent(id)}`); },
    createSession,
    async deleteSession(id) { listeners.delete(id); sessionModel.delete(id); used.delete(id); await call("DELETE", `/api/session/${id}`); },
    prompt,
    async complete({ system, text }) {
      const sid = await createSession();
      let out = "";
      for await (const e of prompt({ sessionId: sid, system, text, files: [], model: defaultModel ?? { providerId: "opencode", modelId: "big-pickle" }, signal: new AbortController().signal })) {
        if (e.type === "delta") out += e.text;
        if (e.type === "error") throw new Error(e.message);
      }
      void call("DELETE", `/api/session/${sid}`);
      return out;
    },
    close() { closed = true; proc.kill(); },
  };
}

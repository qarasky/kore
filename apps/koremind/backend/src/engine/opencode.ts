import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo, ProviderConnection, ProviderInfo } from "@zero/shared";
import { CLOSED, IDLE, Pump } from "./pump";
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

/** Providers Zero offers. Everything else OpenCode knows about stays hidden: few providers, no config sprawl. */
const OFFERED: { id: string; name: string }[] = [
  { id: "opencode", name: "OpenCode" },
  { id: "openai", name: "Codex" },
  { id: "openrouter", name: "OpenRouter" },
];

export function mapConnections(integrations: any[]): ProviderConnection[] {
  return OFFERED.map((o) => {
    const i = integrations.find((x) => x?.id === o.id);
    const methods: ProviderConnection["methods"] = [];
    const types = new Set<string>((i?.methods ?? []).map((m: any) => String(m?.type)));
    if (types.has("key") || o.id === "opencode") methods.push("key");
    if (o.id === "openai" && types.has("oauth")) methods.push("signin"); // ChatGPT sign-in is for Codex only
    return { id: o.id, name: o.name, connected: Array.isArray(i?.connections) && i.connections.length > 0, methods };
  });
}

/** Which saved credentials to delete to disconnect an integration. Env-based connections can't be removed from the app. */
export function credentialIdsFor(integration: any): { ids: string[]; envOnly: boolean } {
  const conns: any[] = Array.isArray(integration?.connections) ? integration.connections : [];
  const ids = conns.filter((c) => c?.type === "credential" && c.id).map((c) => String(c.id));
  return { ids, envOnly: ids.length === 0 && conns.some((c) => c?.type === "env") };
}

export function mapModels(providers: { id: string; name: string }[], models: any[], defaultModelId?: string, connected?: Set<string>): ProviderInfo[] {
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
      return { id: p.id, name: p.name, connected: connected ? connected.has(p.id) : true, models: out };
    })
    .filter((p) => p.models.length > 0);
}

// OpenCode 2.2 always registers an (inert) `skill` tool that no config can hide, so the model is told plainly what it has.
export const AGENT_SYSTEM = "You are Zero, a concise, friendly personal assistant. Answer directly. Your only tool is web search; use it only when you need current facts, and never mention or try other tools. You remember useful things about the user between chats automatically: what you remember is given to you at the start of a chat, so never say you cannot remember.";

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

const IDLE_MS = 120_000;

export async function createOpencodeEngine(opts: { dataDir: string; bin?: string; config?: Record<string, unknown> }): Promise<Engine> {
  const xdg = join(opts.dataDir, "opencode");
  for (const d of ["data", "config", "state", "cache"]) mkdirSync(join(xdg, d), { recursive: true });
  const proc = Bun.spawn([opts.bin ?? "opencode", "serve", "--hostname=127.0.0.1", "--port=0"], {
    env: {
      ...process.env,
      XDG_DATA_HOME: join(xdg, "data"), XDG_CONFIG_HOME: join(xdg, "config"),
      XDG_STATE_HOME: join(xdg, "state"), XDG_CACHE_HOME: join(xdg, "cache"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...zeroOpencodeConfig, ...opts.config }),
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
  let dead = false;
  const pumps = new Set<Pump<EngineEvent>>();
  void proc.exited.then(() => {
    dead = true;
    for (const p of pumps) p.push({ type: "error", message: "The assistant engine stopped. Restart Zero." });
  });
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
    const [m, d, ig] = await Promise.all([call("GET", "/api/model"), call("GET", "/api/model/default"), call("GET", "/api/integration")]);
    const providers = OFFERED.map((o) => ({ id: o.id, name: o.name }));
    const connected = new Set<string>((ig.json?.data ?? []).filter((i: any) => Array.isArray(i.connections) && i.connections.length > 0).map((i: any) => String(i.id)));
    const out = mapModels(providers, m.json?.data ?? [], d.json?.data?.id, connected);
    const home = out.find((x) => x.id === "opencode") ?? out[0];
    const def = home?.models.find((x) => x.isDefault);
    if (def) defaultModel = { providerId: home.id, modelId: def.id };
    return out;
  };

  const oauthMethod = (integration: any): string | undefined => {
    const ms: any[] = (integration?.methods ?? []).filter((m: any) => m?.type === "oauth");
    return (ms.find((m) => m.id === "chatgpt-token-sharing") ?? ms[0])?.id;
  };

  const createSession = async (model?: { providerId: string; modelId: string }) => {
    const m = model ?? defaultModel ?? (await listProviders().then(() => defaultModel));
    // A title of our own stops OpenCode making a second model call just to name the session; Zero names chats itself.
    const r = await call("POST", "/api/session", { title: "Zero", ...(m ? { model: { id: m.modelId, providerID: m.providerId } } : {}) });
    if (!r.ok) throw new Error(`could not create engine session (${r.status})`);
    if (m) sessionModel.set(r.json.data.id, `${m.providerId}/${m.modelId}/`);
    return r.json.data.id as string;
  };

  async function* prompt(a: PromptArgs): AsyncIterable<EngineEvent> {
    if (dead) { yield { type: "error", message: "The assistant engine stopped. Restart Zero." }; return; }
    const pump = new Pump<EngineEvent>(IDLE_MS);
    pumps.add(pump);
    const set = listeners.get(a.sessionId) ?? new Set();
    listeners.set(a.sessionId, set);
    const onRaw = (raw: Raw) => { pump.touch(); for (const ev of mapEvent(a.sessionId, raw)) pump.push(ev); };
    set.add(onRaw);
    const onAbort = () => { void call("POST", `/api/session/${a.sessionId}/interrupt`).catch(() => {}); pump.close(); };
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
      for (;;) {
        const v = await pump.next();
        if (v === CLOSED) return;
        if (v === IDLE) { yield { type: "error", message: "The assistant stopped responding. Try again." }; return; }
        yield v;
        if (v.type === "done" || v.type === "error") return;
      }
    } finally {
      pumps.delete(pump);
      set.delete(onRaw);
      a.signal.removeEventListener("abort", onAbort);
    }
  }

  return {
    listProviders,
    async listConnections() {
      const ig = await call("GET", "/api/integration");
      return mapConnections(ig.json?.data ?? []);
    },
    async startSignIn(id) {
      const ig = await call("GET", "/api/integration");
      const methodID = oauthMethod((ig.json?.data ?? []).find((x: any) => x.id === id));
      if (!methodID) throw new Error("This provider has no browser sign-in");
      // The first OAuth call on a freshly started engine answers 500; the retry succeeds.
      let r = await call("POST", `/api/integration/${encodeURIComponent(id)}/connect/oauth`, { methodID });
      for (let n = 0; !r.ok && n < 3; n++) {
        await Bun.sleep(300);
        r = await call("POST", `/api/integration/${encodeURIComponent(id)}/connect/oauth`, { methodID });
      }
      if (!r.ok || !r.json?.data?.attemptID) throw new Error(`could not start sign-in (${r.status})`);
      const d = r.json.data;
      return { attemptId: String(d.attemptID), url: String(d.url), instructions: String(d.instructions ?? "") };
    },
    async signInStatus(id, attemptId) {
      const r = await call("GET", `/api/integration/${encodeURIComponent(id)}/connect/oauth/${encodeURIComponent(attemptId)}`);
      const st = r.json?.data?.status;
      return { status: st === "complete" ? "complete" : st === "pending" ? "pending" : "failed" };
    },
    async setProviderKey(id, key) {
      // A freshly started engine can answer 404 for a few seconds while its provider catalog loads.
      let r = await call("POST", `/api/integration/${encodeURIComponent(id)}/connect/key`, { key });
      for (let n = 0; r.status === 404 && n < 6; n++) {
        await Bun.sleep(700);
        r = await call("POST", `/api/integration/${encodeURIComponent(id)}/connect/key`, { key });
      }
      if (!r.ok) throw new Error(`Could not connect this provider (${r.status})`);
    },
    async removeProviderKey(id) {
      const ig = await call("GET", `/api/integration/${encodeURIComponent(id)}`);
      const { ids, envOnly } = credentialIdsFor(ig.json?.data);
      if (envOnly) throw new Error("This provider is connected through an environment variable on the server. Remove the variable to disconnect it.");
      for (const cid of ids) {
        const r = await call("DELETE", `/api/credential/${encodeURIComponent(cid)}`);
        if (!r.ok) throw new Error(`Could not disconnect (${r.status})`);
      }
    },
    createSession,
    async deleteSession(id) { listeners.delete(id); sessionModel.delete(id); used.delete(id); await call("DELETE", `/api/session/${id}`); },
    prompt,
    async complete({ system, text, model }) {
      const m = model ?? defaultModel ?? { providerId: "opencode", modelId: "big-pickle" };
      const sid = await createSession(m);
      let out = "";
      try {
        for await (const e of prompt({ sessionId: sid, system, text, files: [], model: m, signal: new AbortController().signal })) {
          if (e.type === "delta") out += e.text;
          if (e.type === "error") throw new Error(e.message);
        }
      } finally { void call("DELETE", `/api/session/${sid}`); }
      return out;
    },
    close() { closed = true; proc.kill(); },
  };
}

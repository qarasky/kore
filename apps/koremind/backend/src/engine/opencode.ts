import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo, ProviderConnection, ProviderInfo } from "@koremind/shared";
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
/** Pages named by a web search result: OpenCode 2.2 returns Markdown whose results are `## [Title](https://…)` headings. */
export function searchSources(content: unknown): { title: string; url: string }[] {
  const text = Array.isArray(content) ? content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n") : "";
  const seen = new Set<string>(), out: { title: string; url: string }[] = [];
  for (const m of text.matchAll(/^#{1,6}\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gm)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ title: m[1].trim(), url: m[2] });
    if (out.length === 8) break;
  }
  return out;
}

/**
 * `ctx` remembers which tool the current call is: OpenCode 2.2 names it only on `input.started` (`{name}`), and the later
 * events of that call (`called`, `success`) carry no name. Older servers put `tool` on every event; both work.
 */
export function mapEvent(sessionId: string, raw: Raw, ctx: { tool?: string } = {}): EngineEvent[] {
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
    case "session.tool.input.started":
      ctx.tool = typeof d.name === "string" ? d.name : undefined;
      return ctx.tool === "websearch" ? [{ type: "status", state: "searching" }] : [];
    case "session.tool.called":
    case "session.tool.started":
      return d.tool === "websearch" ? [{ type: "status", state: "searching" }] : [];
    case "session.tool.success": {
      const tool = d.tool ?? ctx.tool;
      ctx.tool = undefined;
      if (tool !== "websearch") return [];
      const results = d.structured?.results;
      const found = Array.isArray(results) ? results.filter((r: any) => r?.url).map((r: any) => ({ title: String(r.title ?? r.url), url: String(r.url) })) : searchSources(d.content);
      return found.map((r) => ({ type: "source", title: r.title, url: r.url }) as EngineEvent);
    }
    default:
      return [];
  }
}

/**
 * Providers KoreMind offers, in the order clients show them: the recommended ones first.
 * Everything else OpenCode knows about stays hidden: few providers, no config sprawl.
 */
export const OFFERED: { id: string; name: string; recommended: boolean }[] = [
  { id: "groq", name: "Groq", recommended: true },
  { id: "openrouter", name: "OpenRouter", recommended: true },
  { id: "opencode", name: "OpenCode", recommended: false },
  // The OpenCode Go subscription: its own catalog of paid-by-plan models, connected with the same kind of key.
  { id: "opencode-go", name: "OpenCode Go", recommended: false },
  { id: "openai", name: "Codex", recommended: false },
];

export function mapConnections(integrations: any[]): ProviderConnection[] {
  return OFFERED.map((o) => {
    const i = integrations.find((x) => x?.id === o.id);
    const methods: ProviderConnection["methods"] = [];
    const types = new Set<string>((i?.methods ?? []).map((m: any) => String(m?.type)));
    if (types.has("key") || o.id === "opencode" || o.id === "opencode-go") methods.push("key");
    if (o.id === "openai" && types.has("oauth")) methods.push("signin"); // ChatGPT sign-in is for Codex only
    return { id: o.id, name: o.name, connected: Array.isArray(i?.connections) && i.connections.length > 0, methods, recommended: o.recommended, supportsFreeFilter: o.id === "opencode" || o.id === "openrouter" };
  });
}

/** Which saved credentials to delete to disconnect an integration. Env-based connections can't be removed from the app. */
export function credentialIdsFor(integration: any): { ids: string[]; envOnly: boolean } {
  const conns: any[] = Array.isArray(integration?.connections) ? integration.connections : [];
  const ids = conns.filter((c) => c?.type === "credential" && c.id).map((c) => String(c.id));
  return { ids, envOnly: ids.length === 0 && conns.some((c) => c?.type === "env") };
}

/** A model is free when it has price tiers and every one of them costs nothing. */
export const isFree = (m: any): boolean => Array.isArray(m?.cost) && m.cost.length > 0 && m.cost.every((c: any) => c?.input === 0 && c?.output === 0);

/** Groq also serves safety classifiers (Prompt Guard, Safety GPT OSS); they can't chat, so they stay out of the picker. */
export const isChatModel = (m: any): boolean => !/prompt-guard|safeguard/i.test(String(m?.id ?? ""));

export function mapModels(providers: { id: string; name: string; recommended?: boolean }[], models: any[], defaultModelId?: string, connected?: Set<string>): ProviderInfo[] {
  return providers.map((p): ProviderInfo => {
    const ms = models.filter((m) => m.providerID === p.id && m.enabled !== false && m.status !== "disabled" && isChatModel(m));
    const defId = ms.find((m) => m.id === defaultModelId)?.id ?? ms[0]?.id;
    const out: ModelInfo[] = ms.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      vision: Array.isArray(m.capabilities?.input) && m.capabilities.input.includes("image"),
      thinkingLevels: (m.variants ?? []).map((v: any) => String(v.id ?? v)),
      isDefault: m.id === defId,
      free: isFree(m),
    }));
    const isConnected = connected ? connected.has(p.id) : true;
    // OpenCode's free tier needs no key, so it is usable while "not connected".
    return { id: p.id, name: p.name, recommended: p.recommended ?? false, connected: isConnected, status: isConnected || p.id === "opencode" ? "ready" : "needs_connection", models: out };
  });
}

/**
 * The model's text before and after a tool call arrives as separate runs with nothing between them ("I'll check.**Latest…").
 * Returns a stateful mapper that puts a blank line between them.
 */
export function separateAfterTools(): (e: EngineEvent) => EngineEvent {
  let tail = "", toolSince = false;
  return (e) => {
    if (e.type === "status" && e.state === "searching") { if (tail) toolSince = true; return e; }
    if (e.type !== "delta" || !e.text) return e;
    let text = e.text;
    if (toolSince) {
      toolSince = false;
      const have = tail.endsWith("\n\n") ? 2 : tail.endsWith("\n") ? 1 : 0;
      const lead = text.match(/^\n*/)![0].length;
      text = "\n".repeat(Math.max(0, 2 - have - lead)) + text;
    }
    tail = (tail + text).slice(-2);
    return { type: "delta", text };
  };
}

// OpenCode 2.2 always registers an (inert) `skill` tool that no config can hide, so the model is told plainly what it has.
/** How the assistant talks. Tuned against DeepSeek V4.1 Flash at High (see docs/rich-messages.md for the card format). */
const STYLE = "You are KoreMind, a personal assistant in a chat app. Be concise and direct: lead with the answer or the artefact, then only what is needed to use it. Reply in the language the user writes in. No filler openings, no flattery, no closing offers, no moralising. Be honest: name costs and uncertainty plainly, say when you don't know, never invent versions, flags, prices or facts, and search the web when the answer depends on current facts (do not announce that you are about to search; search, then answer). If one short question is needed to do the job, ask it; otherwise make a sensible choice, say which, and carry on. When asked for code or config, give the complete file, not a patch. Do not pad: no unrequested extras (production advice, alternatives, caveats that don't change what to do), and no analogies unless asked. Decide before you write; never correct yourself mid-sentence. State facts about the user only when they are in your context; never invent traits or details about them. Match length to the question: a greeting or a casual remark gets a sentence or two of plain prose, never a list. Use Markdown only where it helps reading: code blocks for code, short lists for steps or options, a table for comparisons; no decoration.";
/** What the clients can draw beyond plain text. Web and Android render the same cards from shared/src/cards.ts. */
const RICH = "Markdown renders tables, lists, code blocks (with a Copy button), links and https images (use an image address only if the user gave it or a search result returned it; never invent one). For a compact status or a total with its breakdown you may use a card: a fenced block tagged card holding one JSON object, {\"title\": text, \"subtitle\": text, \"badge\": {\"text\": text, \"tone\": \"good|warn|bad|info|neutral\"}, \"sections\": [ {\"type\": \"stats\", \"items\": [{\"label\": text, \"value\": text, \"tone\": tone}]} (one to four big numbers), {\"type\": \"table\", \"columns\": [text], \"rows\": [[text]], \"totalRow\": true}, {\"type\": \"bars\", \"items\": [{\"label\": text, \"value\": text, \"share\": number from 0 to 1}]}, {\"type\": \"note\", \"text\": text} ]}. Every value is a string with its unit or currency; all keys are optional except what a section needs. Valid JSON only. Use a card only when it is clearer than prose or a plain table (a status, a total with a breakdown, numbers that compare); use at most two per reply, never for ordinary answers or a single fact, and put the explanation in normal text outside the block. A plain comparison is a Markdown table, not a card.";
const TOOLS = "Your tools: web search (use it only when you need current facts) and notes (save_note, read_notes, edit_note) for things the user wants written down in this chat. Notes belong to one chat; to look at or change another chat's notes, pass that chat's title in the tool call and the user is asked to approve, so only do that when they ask you to. If it is refused, accept that. Never mention or try other tools. You remember useful things about the user between chats automatically: what you remember is given to you at the start of a chat, so never say you cannot remember.";
export const AGENT_SYSTEM = [STYLE, RICH, TOOLS].join(" ");

export const koremindOpencodeConfig = {
  default_agent: "koremind",
  websearch: { provider: "random" },
  warming: true,
  agents: {
    koremind: {
      mode: "primary",
      system: AGENT_SYSTEM,
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "websearch", resource: "*", effect: "allow" },
        { action: "koremind_*", resource: "*", effect: "allow" }, // KoreMind's own notes tools (MCP server "koremind")
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
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...koremindOpencodeConfig, ...opts.config }),
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
    for (const p of pumps) p.push({ type: "error", message: "The assistant engine stopped. Restart KoreMind." });
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
    const providers = OFFERED.map((o) => ({ id: o.id, name: o.name, recommended: o.recommended }));
    const connected = new Set<string>((ig.json?.data ?? []).filter((i: any) => Array.isArray(i.connections) && i.connections.length > 0).map((i: any) => String(i.id)));
    const out = mapModels(providers, m.json?.data ?? [], d.json?.data?.id, connected);
    const home = out.find((x) => x.id === "opencode" && x.models.length) ?? out.find((x) => x.models.length) ?? out[0];
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
    // A title of our own stops OpenCode making a second model call just to name the session; KoreMind names chats itself.
    const r = await call("POST", "/api/session", { title: "KoreMind", ...(m ? { model: { id: m.modelId, providerID: m.providerId } } : {}) });
    if (!r.ok) throw new Error(`could not create engine session (${r.status})`);
    if (m) sessionModel.set(r.json.data.id, `${m.providerId}/${m.modelId}/`);
    return r.json.data.id as string;
  };

  async function* prompt(a: PromptArgs): AsyncIterable<EngineEvent> {
    if (dead) { yield { type: "error", message: "The assistant engine stopped. Restart KoreMind." }; return; }
    const pump = new Pump<EngineEvent>(IDLE_MS);
    pumps.add(pump);
    const set = listeners.get(a.sessionId) ?? new Set();
    listeners.set(a.sessionId, set);
    const tool: { tool?: string } = {};
    const onRaw = (raw: Raw) => { pump.touch(); for (const ev of mapEvent(a.sessionId, raw, tool)) pump.push(ev); };
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
      const join = separateAfterTools();
      for (;;) {
        const v = await pump.next();
        if (v === CLOSED) return;
        if (v === IDLE) { yield { type: "error", message: "The assistant stopped responding. Try again." }; return; }
        yield join(v);
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
    async complete({ system, text, model, thinking }) {
      const m = model ?? defaultModel ?? { providerId: "opencode", modelId: "big-pickle" };
      const sid = await createSession(m);
      let out = "";
      try {
        for await (const e of prompt({ sessionId: sid, system, text, files: [], model: m, thinking, signal: new AbortController().signal })) {
          if (e.type === "delta") out += e.text;
          if (e.type === "error") throw new Error(e.message);
        }
      } finally { void call("DELETE", `/api/session/${sid}`).catch(() => {}); }
      return out;
    },
    close() { closed = true; proc.kill(); },
  };
}

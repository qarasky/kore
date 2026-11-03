import type { ModelInfo, ProviderConnection, ProviderInfo, SignInStart, SignInStatus } from "@koremind/shared";
import type { Engine, EngineEvent, ModelRef, PromptArgs } from "./types";

export type FakeOptions = {
  providers?: ProviderInfo[];
  reply?: (a: PromptArgs) => EngineEvent[];
  completeReply?: string;
  /** Reply for chat-title requests. Empty (default) means "no title". A function may throw. */
  titleReply?: string | (() => string);
  completeDelayMs?: number;
  /** Runs after the first status event, before the scripted reply. Tests use it to act like the model calling tools. */
  during?: (a: PromptArgs) => Promise<void>;
  delayMs?: number;
};

/** Scripted engine for tests and for running without OpenCode (KOREMIND_FAKE_ENGINE=1). */
export class FakeEngine implements Engine {
  sessions = new Set<string>();
  prompts: PromptArgs[] = [];
  keys = new Map<string, string>();
  completes: { kind: "title" | "memory"; system: string; text: string; model?: ModelRef }[] = [];
  signIns = new Map<string, { providerId: string; done: boolean }>();
  constructor(private o: FakeOptions = {}) {}

  async listConnections(): Promise<ProviderConnection[]> {
    const conn = (id: string, name: string, methods: ProviderConnection["methods"], supportsFreeFilter: boolean): ProviderConnection => ({ id, name, connected: this.connected(id), methods, supportsFreeFilter });
    return [conn("opencode", "OpenCode", ["key"], true), conn("openai", "Codex", ["key", "signin"], false), conn("openrouter", "OpenRouter", ["key"], true)];
  }
  async startSignIn(providerId: string): Promise<SignInStart> {
    const attemptId = `at_${crypto.randomUUID()}`;
    this.signIns.set(attemptId, { providerId, done: false });
    return { attemptId, url: "https://auth.example.test/authorize", instructions: "Complete authorization in your browser." };
  }
  async signInStatus(_providerId: string, attemptId: string): Promise<SignInStatus> {
    const a = this.signIns.get(attemptId);
    return { status: !a ? "failed" : a.done ? "complete" : "pending" };
  }
  /** Test helper: the owner finished the browser step. */
  finishSignIn(attemptId: string) { const a = this.signIns.get(attemptId); if (a) a.done = true; }

  private signedIn() { return new Set([...this.signIns.values()].filter((x) => x.done).map((x) => x.providerId)); }
  private connected(id: string) { return this.keys.has(id) || this.signedIn().has(id); }

  /** OpenCode (free tier, always ready), Codex (empty until connected) and OpenRouter (a free and a paid model once connected). */
  async listProviders(): Promise<ProviderInfo[]> {
    if (this.o.providers) return this.o.providers;
    const m = (id: string, name: string, over: Partial<ModelInfo> = {}): ModelInfo => ({ id, name, vision: false, thinkingLevels: [], isDefault: false, free: false, ...over });
    const or = this.connected("openrouter");
    const ai = this.connected("openai");
    return [
      { id: "opencode", name: "OpenCode", connected: this.connected("opencode"), status: "ready", models: [m("fast", "Fast", { isDefault: true, free: true }), m("vision", "Vision", { vision: true, thinkingLevels: ["low", "high"] })] },
      { id: "openai", name: "Codex", connected: ai, status: ai ? "ready" : "needs_connection", models: ai ? [m("gpt", "GPT", { isDefault: true })] : [] },
      { id: "openrouter", name: "OpenRouter", connected: or, status: or ? "ready" : "needs_connection", models: or ? [m("acme/free-model:free", "Free Model", { free: true, isDefault: true }), m("acme/pro", "Pro")] : [] },
    ];
  }
  async setProviderKey(id: string, key: string) { this.keys.set(id, key); }
  async removeProviderKey(id: string) { this.keys.delete(id); }
  async createSession() { const id = `fs_${crypto.randomUUID()}`; this.sessions.add(id); return id; }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async complete(a: { kind?: "title" | "memory"; system: string; text: string; model?: ModelRef }) {
    const kind = a.kind ?? "memory";
    this.completes.push({ kind, system: a.system, text: a.text, model: a.model });
    if (this.o.completeDelayMs) await Bun.sleep(this.o.completeDelayMs);
    if (kind === "title") { const r = this.o.titleReply; return typeof r === "function" ? r() : (r ?? ""); }
    return this.o.completeReply ?? '{"add":[]}';
  }
  close() {}

  async *prompt(a: PromptArgs): AsyncIterable<EngineEvent> {
    this.prompts.push(a);
    yield { type: "status", state: "thinking" };
    if (this.o.during) await this.o.during(a);
    const events = this.o.reply ? this.o.reply(a) : [{ type: "delta", text: `echo: ${a.text}` } as EngineEvent];
    for (const ev of events) {
      if (a.signal.aborted) return;
      if (this.o.delayMs) await Bun.sleep(this.o.delayMs);
      if (a.signal.aborted) return;
      yield ev;
      if (ev.type === "done" || ev.type === "error") return;
    }
    if (!a.signal.aborted) yield { type: "done" };
  }
}

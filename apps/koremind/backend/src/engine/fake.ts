import type { ModelInfo, ProviderConnection, ProviderInfo } from "@koremind/shared";
import type { Engine, EngineEvent, ModelRef, PromptArgs } from "./types";

export type FakeOptions = {
  providers?: ProviderInfo[];
  reply?: (a: PromptArgs) => EngineEvent[];
  completeReply?: string;
  /** Reply for chat-title requests. Empty (default) means "no title". A function may throw. */
  titleReply?: string | (() => string);
  completeDelayMs?: number;
  /** Makes complete() throw for the models this returns true for (undefined = the engine default). */
  completeFails?: (model: ModelRef | undefined) => boolean;
  /** Runs after the first status event, before the scripted reply. Tests use it to act like the model calling tools. */
  during?: (a: PromptArgs) => Promise<void>;
  delayMs?: number;
};

/** Scripted engine for tests and for running without OpenCode (KOREMIND_FAKE_ENGINE=1). */
export class FakeEngine implements Engine {
  sessions = new Set<string>();
  prompts: PromptArgs[] = [];
  completes: { kind: "title" | "memory"; system: string; text: string; model?: ModelRef; thinking?: string }[] = [];
  /** Providers signed in on the (pretend) server. OpenCode's free tier is usable without it. */
  connected = new Set<string>();
  constructor(private o: FakeOptions = {}) {}

  async listConnections(): Promise<ProviderConnection[]> {
    const conn = (id: string, name: string, supportsFreeFilter: boolean, hint: string): ProviderConnection => ({ id, name, connected: this.connected.has(id), supportsFreeFilter, hint: this.connected.has(id) ? "" : hint });
    return [
      conn("claude", "Claude", false, "Run `claude auth login` on the server, as the user KoreMind runs as."),
      conn("opencode", "OpenCode", true, ""),
      conn("opencode-go", "OpenCode Go", false, "Set OPENCODE_API_KEY in KoreMind's server environment."),
    ];
  }

  /** Claude and OpenCode Go are empty until signed in; OpenCode's free tier is always ready. */
  async listProviders(): Promise<ProviderInfo[]> {
    if (this.o.providers) return this.o.providers;
    const m = (id: string, name: string, over: Partial<ModelInfo> = {}): ModelInfo => ({ id, name, vision: false, thinkingLevels: [], isDefault: false, free: false, ...over });
    const cl = this.connected.has("claude");
    const go = this.connected.has("opencode-go");
    return [
      { id: "claude", name: "Claude", recommended: false, connected: cl, status: cl ? "ready" : "needs_connection", models: cl ? [m("claude-sonnet-5-5", "Sonnet 5.5", { isDefault: true, vision: true, thinkingLevels: ["low", "high"] }), m("claude-haiku-5-5", "Haiku 5.5", { vision: true })] : [] },
      { id: "opencode", name: "OpenCode", recommended: false, connected: this.connected.has("opencode"), status: "ready", models: [m("fast", "Fast", { isDefault: true, free: true }), m("vision", "Vision", { vision: true, thinkingLevels: ["low", "high"] })] },
      { id: "opencode-go", name: "OpenCode Go", recommended: false, connected: go, status: go ? "ready" : "needs_connection", models: go ? [m("deepseek-pro", "DeepSeek Pro", { isDefault: true }), m("glm", "GLM", { thinkingLevels: ["low", "high"] })] : [] },
    ];
  }
  async createSession() { const id = `fs_${crypto.randomUUID()}`; this.sessions.add(id); return id; }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async complete(a: { kind?: "title" | "memory"; system: string; text: string; model?: ModelRef; thinking?: string }) {
    const kind = a.kind ?? "memory";
    this.completes.push({ kind, system: a.system, text: a.text, model: a.model, thinking: a.thinking });
    if (this.o.completeFails?.(a.model)) throw new Error("model unavailable");
    if (this.o.completeDelayMs) await Bun.sleep(this.o.completeDelayMs);
    if (kind === "title") { const r = this.o.titleReply; return typeof r === "function" ? r() : (r ?? ""); }
    return this.o.completeReply ?? "A fake profile of the user.";
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

import type { ProviderConnection, ProviderInfo, SignInStart, SignInStatus } from "@zero/shared";
import type { Engine, EngineEvent, ModelRef, PromptArgs } from "./types";

export type FakeOptions = {
  providers?: ProviderInfo[];
  reply?: (a: PromptArgs) => EngineEvent[];
  completeReply?: string;
  /** Reply for chat-title requests. Empty (default) means "no title". A function may throw. */
  titleReply?: string | (() => string);
  completeDelayMs?: number;
  delayMs?: number;
};

const defaultProviders: ProviderInfo[] = [
  {
    id: "opencode", name: "OpenCode", connected: true,
    models: [
      { id: "fast", name: "Fast", vision: false, thinkingLevels: [], isDefault: true },
      { id: "vision", name: "Vision", vision: true, thinkingLevels: ["low", "high"], isDefault: false },
    ],
  },
];

/** Scripted engine for tests and for running without OpenCode (ZERO_FAKE_ENGINE=1). */
export class FakeEngine implements Engine {
  sessions = new Set<string>();
  prompts: PromptArgs[] = [];
  keys = new Map<string, string>();
  completes: { kind: "title" | "memory"; system: string; text: string; model?: ModelRef }[] = [];
  signIns = new Map<string, { providerId: string; done: boolean }>();
  constructor(private o: FakeOptions = {}) {}

  async listConnections(): Promise<ProviderConnection[]> {
    const signedIn = new Set([...this.signIns.values()].filter((s) => s.done).map((s) => s.providerId));
    const conn = (id: string, name: string, methods: ProviderConnection["methods"]): ProviderConnection => ({ id, name, connected: this.keys.has(id) || signedIn.has(id), methods });
    return [conn("opencode", "OpenCode", ["key"]), conn("openai", "Codex", ["key", "signin"]), conn("openrouter", "OpenRouter", ["key"])];
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

  async listProviders() { return this.o.providers ?? defaultProviders; }
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

import type { ProviderInfo } from "@zero/shared";
import type { Engine, EngineEvent, PromptArgs } from "./types";

export type FakeOptions = {
  providers?: ProviderInfo[];
  reply?: (a: PromptArgs) => EngineEvent[];
  completeReply?: string;
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
  constructor(private o: FakeOptions = {}) {}

  async listProviders() { return this.o.providers ?? defaultProviders; }
  async setProviderKey(id: string, key: string) { this.keys.set(id, key); }
  async removeProviderKey(id: string) { this.keys.delete(id); }
  async createSession() { const id = `fs_${crypto.randomUUID()}`; this.sessions.add(id); return id; }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async complete() { return this.o.completeReply ?? '{"add":[]}'; }
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

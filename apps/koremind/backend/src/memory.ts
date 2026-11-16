import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry } from "@koremind/shared";
import type { Engine, ModelRef } from "./engine/types";

const LINE = /^- (.*) <!--id:([a-z0-9]+) t:(\d+)-->$/;
const clean = (t: string) => t.replace(/<!--|-->/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8);

/** Memory is always written by this model, at this thinking level, so its quality doesn't depend on which model you chat with. */
export const MEMORY_MODEL: ModelRef = { providerId: "opencode-go", modelId: "deepseek-v4.1-flash" };
export const MEMORY_THINKING = "high";

const EXTRACT_SYSTEM =
  'You maintain a short memory about the user of a personal assistant. From the latest exchange, extract only durable facts or preferences about the user themself that are worth remembering across chats (name, location, tastes, projects, habits). Never save a request or an action (asking for a note, a search, a translation, a summary), anything about notes or their titles and contents, anything that looks like the user testing the app, or anything already in memory. Most exchanges contain nothing worth saving. Reply with ONLY JSON: {"add": ["short fact", ...]}. If nothing is worth saving reply {"add": []}.';

export function createMemory(dir: string, engine: Engine, isEnabled: (userId: string) => boolean) {
  const file = (userId: string) => join(dir, userId.replace(/[^a-zA-Z0-9-]/g, ""), "memory.md");
  const read = (userId: string): MemoryEntry[] => {
    const f = file(userId);
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").flatMap((l) => {
      const m = LINE.exec(l);
      return m ? [{ id: m[2], text: m[1], updatedAt: Number(m[3]) }] : [];
    });
  };
  const write = (userId: string, entries: MemoryEntry[]) => {
    const f = file(userId);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "# Memory\n\n" + entries.map((e) => `- ${e.text} <!--id:${e.id} t:${e.updatedAt}-->`).join("\n") + "\n");
  };

  return {
    list: read,
    update(userId: string, id: string, text: string) {
      const t = clean(text);
      if (!t) return;
      write(userId, read(userId).map((e) => (e.id === id ? { ...e, text: t, updatedAt: Date.now() } : e)));
    },
    remove(userId: string, id: string) {
      write(userId, read(userId).filter((e) => e.id !== id));
    },
    async extractAfterTurn(userId: string, userText: string, assistantText: string, chatModel?: ModelRef): Promise<void> {
      if (!isEnabled(userId)) return;
      try {
        const existing = read(userId);
        const text = `Existing memory:\n${existing.map((e) => `- ${e.text}`).join("\n") || "(empty)"}\n\nUser said: ${userText}\nAssistant replied: ${assistantText.slice(0, 1500)}`;
        // DeepSeek V4.1 Flash at High first; if it can't answer, the model the chat used; if that fails too, report it.
        const attempts: { model: ModelRef; thinking?: string }[] = [{ model: MEMORY_MODEL, thinking: MEMORY_THINKING }];
        if (chatModel && !(chatModel.providerId === MEMORY_MODEL.providerId && chatModel.modelId === MEMORY_MODEL.modelId)) attempts.push({ model: chatModel });
        let reply: string | undefined;
        const failures: string[] = [];
        for (const a of attempts) {
          try { reply = await engine.complete({ kind: "memory", system: EXTRACT_SYSTEM, text, model: a.model, thinking: a.thinking }); break; }
          catch (e) { failures.push(`${a.model.providerId}/${a.model.modelId}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        if (reply === undefined) { console.error(`memory: could not extract (${failures.join("; ")})`); return; }
        const json = reply.match(/\{[\s\S]*\}/)?.[0];
        if (!json) return;
        const add = (JSON.parse(json).add ?? []) as unknown[];
        const have = new Set(existing.map((e) => e.text.toLowerCase()));
        const fresh = add.filter((x): x is string => typeof x === "string").map(clean).filter((t) => t && !have.has(t.toLowerCase())).slice(0, 5);
        if (fresh.length) write(userId, [...existing, ...fresh.map((text) => ({ id: newId(), text, updatedAt: Date.now() }))]);
      } catch { /* a malformed reply or a disk hiccup: background step, never surfaces */ }
    },
  };
}
export type Memory = ReturnType<typeof createMemory>;

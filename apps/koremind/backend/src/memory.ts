import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry } from "@zero/shared";
import type { Engine } from "./engine/types";

const LINE = /^- (.*) <!--id:([a-z0-9]+) t:(\d+)-->$/;
const clean = (t: string) => t.replace(/<!--|-->/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8);

const EXTRACT_SYSTEM =
  'You maintain a short memory about the user of a personal assistant. From the latest exchange, extract only durable facts or preferences worth remembering across chats (name, location, tastes, projects, habits). Ignore one-off requests and anything already in memory. Reply with ONLY JSON: {"add": ["short fact", ...]}. If nothing is worth saving reply {"add": []}.';

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
    async extractAfterTurn(userId: string, userText: string, assistantText: string): Promise<void> {
      try {
        if (!isEnabled(userId)) return;
        const existing = read(userId);
        const reply = await engine.complete({
          system: EXTRACT_SYSTEM,
          text: `Existing memory:\n${existing.map((e) => `- ${e.text}`).join("\n") || "(empty)"}\n\nUser said: ${userText}\nAssistant replied: ${assistantText.slice(0, 1500)}`,
        });
        const json = reply.match(/\{[\s\S]*\}/)?.[0];
        if (!json) return;
        const add = (JSON.parse(json).add ?? []) as unknown[];
        const have = new Set(existing.map((e) => e.text.toLowerCase()));
        const fresh = add.filter((x): x is string => typeof x === "string").map(clean).filter((t) => t && !have.has(t.toLowerCase())).slice(0, 5);
        if (fresh.length) write(userId, [...existing, ...fresh.map((text) => ({ id: newId(), text, updatedAt: Date.now() }))]);
      } catch { /* background step: never surfaces */ }
    },
  };
}
export type Memory = ReturnType<typeof createMemory>;

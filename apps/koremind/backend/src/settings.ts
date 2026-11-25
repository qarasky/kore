import type { Database } from "bun:sqlite";
import { defaultSettings, type Settings } from "@koremind/shared";

export function createSettings(db: Database) {
  return {
    get(userId: string): Settings {
      const r = db.query("select json from settings where user_id=?").get(userId) as { json: string } | null;
      return r ? { ...defaultSettings, ...JSON.parse(r.json) } : { ...defaultSettings };
    },
    put(userId: string, s: Settings) {
      db.run("insert or replace into settings(user_id,json) values(?,?)", [userId, JSON.stringify(s)]);
    },
    /** Context block sent with the first prompt of a chat. "" when there is nothing to say. */
    buildSystem(s: Settings, memory: { summary: string; count: number }): string {
      const lines: string[] = [];
      if (s.displayName) lines.push(`The user's name is ${s.displayName}.`);
      if (s.tone) lines.push(`Talk to them in this style: ${s.tone}.`);
      if (s.about) lines.push(`About the user: ${s.about}`);
      if (!s.memoryEnabled) {
        lines.push("The user turned memory off: do not use the memory tools in this chat.");
      } else if (memory.count) {
        if (memory.summary) lines.push("What you know about the user, in broad strokes:", memory.summary);
        lines.push(`You have ${memory.count} saved ${memory.count === 1 ? "memory" : "memories"} about them; look details up with recall_memory when they would help.`);
        lines.push("Use what you know when it helps with what they ask; don't recite it, and don't bring it up in reply to a greeting.");
      }
      return lines.join("\n");
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettings>;

import type { Database } from "bun:sqlite";
import { defaultSettings, type MemoryEntry, type Settings } from "@koremind/shared";

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
    buildSystem(s: Settings, memory: MemoryEntry[]): string {
      const lines: string[] = [];
      if (s.displayName) lines.push(`The user's name is ${s.displayName}.`);
      if (s.tone) lines.push(`Talk to them in this style: ${s.tone}.`);
      if (s.about) lines.push(`About the user: ${s.about}`);
      if (s.memoryEnabled && memory.length) lines.push("What you remember about the user:", ...memory.map((m) => `- ${m.text}`));
      return lines.join("\n");
    },
  };
}
export type SettingsStore = ReturnType<typeof createSettings>;

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry, MemorySummary } from "@koremind/shared";
import type { Engine, ModelRef } from "./engine/types";

const LINE = /^- (.*) <!--id:([a-z0-9]+) t:(\d+)-->$/;
const clean = (t: string) => t.replace(/<!--|-->/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 8);

const MAX_TEXT = 300;
const MAX_ENTRIES = 200;
const MAX_RECALL = 20;
const SUMMARY_DELAY_MS = 4000;

/** The profile is always written by this model, at this thinking level, so its quality doesn't depend on which model you chat with. */
export const MEMORY_MODEL: ModelRef = { providerId: "opencode-go", modelId: "deepseek-v4.1-flash" };
export const MEMORY_THINKING = "high";

export const SUMMARY_SYSTEM =
  "You write a short, abstract profile of the user of a personal assistant from the facts it has saved about them. The assistant reads it at the start of every chat to know who it is talking to in broad strokes; the specific facts stay in memory and it looks them up when it needs them. Write 3 to 6 short plain lines, no headings or bullets: who they are, what they work on or care about, and how they like to be answered. Stay general: leave out exact numbers, dates, addresses, account names, people other than the user and anything sensitive (health, money, relationships), and never invent anything that the facts do not say. Refer to the user with the pronouns the facts give, otherwise they/them. Write in the language most of the facts are in. Reply with only the profile.";

type ToolResult = { text: string; isError?: boolean };
export type MemoryCtx = { userId: string; chatId: string };
type Hooks = { emit?(chatId: string, a: { kind: "memory_saved" | "memory_updated" | "memory_read" | "memory_deleted"; title: string }): void };

/** Words of a query, lower-cased; long words are cut to a stem so "travelling" finds "travel" and "Алматы" finds "Алмате". */
export function queryTerms(q: string): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 2).map((w) => (w.length > 4 ? w.slice(0, Math.max(4, Math.ceil(w.length * 0.6))) : w)))];
}

/** Entries that share words with the query, best first. Ties go to the most recently changed. */
export function rankMemory(entries: MemoryEntry[], query: string): MemoryEntry[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  return entries
    .map((e) => { const t = e.text.toLowerCase(); return { e, score: terms.filter((w) => t.includes(w)).length }; })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt)
    .map((x) => x.e);
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const listing = (es: MemoryEntry[]) => es.map((e) => `- [${e.id}] ${e.text} (${day(e.updatedAt)})`).join("\n");
/** Changes whenever an entry is added, edited or removed, so a stale profile can be spotted. */
const fingerprint = (es: MemoryEntry[]) => Bun.hash(es.map((e) => `${e.id}:${e.text}`).join("\n")).toString(36);

export function createMemory(dir: string, engine: Engine, isEnabled: (userId: string) => boolean, hooks: Hooks = {}) {
  const userDir = (userId: string) => join(dir, userId.replace(/[^a-zA-Z0-9-]/g, ""));
  const file = (userId: string) => join(userDir(userId), "memory.md");
  const summaryFile = (userId: string) => join(userDir(userId), "summary.json");
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
    mkdirSync(userDir(userId), { recursive: true });
    writeFileSync(f, "# Memory\n\n" + entries.map((e) => `- ${e.text} <!--id:${e.id} t:${e.updatedAt}-->`).join("\n") + "\n");
    schedule(userId);
  };

  type Stored = MemorySummary & { basedOn: string };
  const readSummary = (userId: string): Stored | null => {
    try { return JSON.parse(readFileSync(summaryFile(userId), "utf8")) as Stored; } catch { return null; }
  };

  /** The model each user chatted with last: the fallback when the memory model can't answer. */
  const lastModel = new Map<string, ModelRef>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();

  /** Rewrites the profile from the current entries. Best effort: a failure is logged and the old profile stays. */
  const refresh = async (userId: string): Promise<void> => {
    const entries = read(userId);
    if (!entries.length) { rmSync(summaryFile(userId), { force: true }); return; }
    const basedOn = fingerprint(entries);
    if (readSummary(userId)?.basedOn === basedOn) return;
    const chat = lastModel.get(userId);
    const attempts: { model: ModelRef; thinking?: string }[] = [{ model: MEMORY_MODEL, thinking: MEMORY_THINKING }];
    if (chat && !(chat.providerId === MEMORY_MODEL.providerId && chat.modelId === MEMORY_MODEL.modelId)) attempts.push({ model: chat });
    const failures: string[] = [];
    const text = `Saved facts about the user:\n${entries.map((e) => `- ${e.text}`).join("\n")}`;
    for (const a of attempts) {
      try {
        const reply = (await engine.complete({ kind: "memory", system: SUMMARY_SYSTEM, text, model: a.model, thinking: a.thinking })).trim().slice(0, 1500);
        if (!reply) throw new Error("empty reply");
        if (fingerprint(read(userId)) !== basedOn) return; // memory changed meanwhile; the next run writes the profile
        mkdirSync(userDir(userId), { recursive: true });
        writeFileSync(summaryFile(userId), JSON.stringify({ text: reply, updatedAt: Date.now(), basedOn } satisfies Stored));
        return;
      } catch (e) { failures.push(`${a.model.providerId}/${a.model.modelId}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    console.error(`memory: could not write the profile (${failures.join("; ")})`);
  };
  /** Several changes in one reply are folded into one rewrite. */
  function schedule(userId: string, delayMs = SUMMARY_DELAY_MS) {
    clearTimeout(timers.get(userId));
    const t = setTimeout(() => { timers.delete(userId); void api.refreshNow(userId); }, delayMs);
    (t as { unref?: () => void }).unref?.();
    timers.set(userId, t);
  }

  const off = (): ToolResult => ({ text: "Memory is turned off by the user. Do not use the memory tools.", isError: true });
  const err = (text: string): ToolResult => ({ text, isError: true });

  const api = {
    list: read,
    summary(userId: string): MemorySummary | null {
      const s = readSummary(userId);
      return s ? { text: s.text, updatedAt: s.updatedAt } : null;
    },
    /** The profile for the start of a chat, if it is current; a missing or stale one is rewritten in the background. */
    currentSummary(userId: string): string {
      const entries = read(userId);
      const s = readSummary(userId);
      if (entries.length && s?.basedOn !== fingerprint(entries) && !timers.has(userId) && !running.has(userId)) schedule(userId, 0);
      return entries.length ? s?.text ?? "" : "";
    },
    async refreshNow(userId: string): Promise<void> {
      const busy = running.get(userId);
      if (busy) { await busy; }
      const p = refresh(userId).catch((e) => console.error(`memory: ${e instanceof Error ? e.message : e}`)).finally(() => running.delete(userId));
      running.set(userId, p);
      await p;
    },
    noteModel(userId: string, model: ModelRef) { lastModel.set(userId, model); },
    update(userId: string, id: string, text: string) {
      const t = clean(text);
      if (!t) return;
      write(userId, read(userId).map((e) => (e.id === id ? { ...e, text: t, updatedAt: Date.now() } : e)));
    },
    remove(userId: string, id: string) {
      write(userId, read(userId).filter((e) => e.id !== id));
    },
    close() { for (const t of timers.values()) clearTimeout(t); timers.clear(); },

    // ---- Tools the chat model calls ----
    tools: {
      remember(ctx: MemoryCtx, a: { text: string }): ToolResult {
        if (!isEnabled(ctx.userId)) return off();
        const t = clean(a.text);
        if (!t) return err("Nothing to remember: the text is empty.");
        const entries = read(ctx.userId);
        const same = entries.find((e) => e.text.toLowerCase() === t.toLowerCase());
        if (same) return { text: `Already remembered as [${same.id}].` };
        if (entries.length >= MAX_ENTRIES) return err(`Memory is full (${MAX_ENTRIES} entries). Update or forget an old entry first.`);
        const e = { id: newId(), text: t, updatedAt: Date.now() };
        write(ctx.userId, [...entries, e]);
        hooks.emit?.(ctx.chatId, { kind: "memory_saved", title: t });
        return { text: `Remembered [${e.id}].` };
      },
      recall(ctx: MemoryCtx, a: { query?: string }): ToolResult {
        if (!isEnabled(ctx.userId)) return off();
        const entries = read(ctx.userId);
        const q = (a.query ?? "").trim();
        hooks.emit?.(ctx.chatId, { kind: "memory_read", title: q });
        if (!entries.length) return { text: "Memory is empty: nothing has been saved about the user yet." };
        if (!q) {
          const newest = [...entries].sort((x, y) => y.updatedAt - x.updatedAt);
          return { text: `${entries.length === 1 ? "The only memory" : `All ${entries.length} memories, newest first`}:\n${listing(newest)}` };
        }
        const hits = rankMemory(entries, q).slice(0, MAX_RECALL);
        if (!hits.length) return { text: `No memory matches "${q}". There are ${entries.length} memories in all; call recall_memory without a query to see them.` };
        return { text: `${hits.length === 1 ? "1 memory matches" : `${hits.length} memories match`} "${q}", best first:\n${listing(hits)}` };
      },
      update(ctx: MemoryCtx, a: { id: string; text: string }): ToolResult {
        if (!isEnabled(ctx.userId)) return off();
        const t = clean(a.text);
        if (!t) return err("The new text is empty. To delete an entry use forget_memory.");
        const entries = read(ctx.userId);
        if (!entries.some((e) => e.id === a.id)) return err(`No memory has the id "${a.id}". Recall first to get ids.`);
        api.update(ctx.userId, a.id, t);
        hooks.emit?.(ctx.chatId, { kind: "memory_updated", title: t });
        return { text: `Updated [${a.id}].` };
      },
      forget(ctx: MemoryCtx, a: { id: string }): ToolResult {
        if (!isEnabled(ctx.userId)) return off();
        const e = read(ctx.userId).find((x) => x.id === a.id);
        if (!e) return err(`No memory has the id "${a.id}". Recall first to get ids.`);
        api.remove(ctx.userId, a.id);
        hooks.emit?.(ctx.chatId, { kind: "memory_deleted", title: e.text });
        return { text: `Forgot [${a.id}].` };
      },
    },
  };
  return api;
}
export type Memory = ReturnType<typeof createMemory>;

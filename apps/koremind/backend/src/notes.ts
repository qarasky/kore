import type { Database } from "bun:sqlite";
import type { Activity } from "@zero/shared";
import type { Outcome } from "./approvals";

export type NoteCtx = { userId: string; chatId: string };
export type ToolResult = { text: string; isError?: boolean };

const MAX_TITLE = 120;
const MAX_BODY = 20_000;
const MAX_NOTES_PER_CHAT = 50;
const MAX_READ_CHARS = 30_000;

type NoteRow = { id: string; title: string; body: string };
const err = (text: string): ToolResult => ({ text, isError: true });
const newId = () => `note_${Buffer.from(crypto.getRandomValues(new Uint8Array(5))).toString("hex")}`;

/**
 * Notes belong to one chat of one user. By default the tools only touch the current chat; reaching into another
 * of the user's chats goes through `ask`, which is the approval card.
 */
export function createNotes(
  db: Database,
  hooks: {
    ask(a: { userId: string; chatId: string; targetChatId: string; chatTitle: string; action: "read" | "edit" }): Promise<Outcome>;
    emit(chatId: string, a: Activity): void;
  },
) {
  type Target = { chatId: string; title: string; cross: boolean } | { error: ToolResult };

  const resolve = (ctx: NoteCtx, chat: string | undefined): Target => {
    const here = db.query("select id,title from chats where id=? and user_id=?").get(ctx.chatId, ctx.userId) as { id: string; title: string } | null;
    if (!here) return { error: err("This chat could not be found.") };
    const q = (chat ?? "").trim();
    if (!q || q === here.id || q.toLowerCase() === here.title.toLowerCase()) return { chatId: here.id, title: here.title, cross: false };
    const mine = db.query("select id,title from chats where user_id=?").all(ctx.userId) as { id: string; title: string }[];
    const exact = mine.filter((c) => c.id === q || c.title.toLowerCase() === q.toLowerCase());
    const hits = exact.length ? exact : mine.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
    if (hits.length === 0) return { error: err(`No chat of this user matches "${q}".`) };
    if (hits.length > 1) return { error: err(`Several chats match "${q}": ${hits.slice(0, 5).map((c) => `"${c.title}"`).join(", ")}. Ask the user which one they mean.`) };
    return { chatId: hits[0].id, title: hits[0].title, cross: hits[0].id !== here.id };
  };

  const gate = async (ctx: NoteCtx, t: Extract<Target, { chatId: string }>, action: "read" | "edit"): Promise<ToolResult | null> => {
    if (!t.cross) return null;
    const outcome = await hooks.ask({ userId: ctx.userId, chatId: ctx.chatId, targetChatId: t.chatId, chatTitle: t.title, action });
    if (outcome === "allowed") return null;
    hooks.emit(ctx.chatId, { kind: "denied", title: "notes", chat: t.title });
    return err(outcome === "denied" ? `The user did not allow access to the notes of "${t.title}". Do not try again; tell them you could not look.` : `The user did not answer in time, so the notes of "${t.title}" were not opened. You may ask them to allow it and try again.`);
  };

  return {
    async save(ctx: NoteCtx, a: { title: string; body: string }): Promise<ToolResult> {
      const title = a.title.trim();
      if (!title) return err("A note needs a title.");
      if (title.length > MAX_TITLE) return err(`The title is too long (max ${MAX_TITLE} characters).`);
      if (!a.body.trim()) return err("A note needs some text.");
      if (a.body.length > MAX_BODY) return err(`The note is too long (max ${MAX_BODY} characters).`);
      const n = (db.query("select count(*) c from notes where chat_id=?").get(ctx.chatId) as { c: number }).c;
      if (n >= MAX_NOTES_PER_CHAT) return err(`This chat already has ${MAX_NOTES_PER_CHAT} notes. Edit one instead.`);
      const id = newId();
      const now = Date.now();
      db.run("insert into notes(id,user_id,chat_id,title,body,created_at,updated_at) values(?,?,?,?,?,?,?)", [id, ctx.userId, ctx.chatId, title, a.body, now, now]);
      hooks.emit(ctx.chatId, { kind: "saved", title });
      return { text: `Saved note ${id} "${title}".` };
    },

    async read(ctx: NoteCtx, a: { chat?: string }): Promise<ToolResult> {
      const t = resolve(ctx, a.chat);
      if ("error" in t) return t.error;
      const refused = await gate(ctx, t, "read");
      if (refused) return refused;
      const rows = db.query("select id,title,body from notes where chat_id=? and user_id=? order by created_at, rowid").all(t.chatId, ctx.userId) as NoteRow[];
      hooks.emit(ctx.chatId, t.cross ? { kind: "read", title: "notes", chat: t.title } : { kind: "read", title: "notes" });
      const where = t.cross ? `the chat "${t.title}"` : "this chat";
      if (!rows.length) return { text: `No notes saved in ${where} yet.` };
      let out = `Notes in ${where}:\n`;
      for (const r of rows) {
        const block = `\n[${r.id}] ${r.title}\n${r.body}\n`;
        if (out.length + block.length > MAX_READ_CHARS) { out += "\n(more notes omitted)"; break; }
        out += block;
      }
      return { text: out };
    },

    async edit(ctx: NoteCtx, a: { id: string; title?: string; body?: string; chat?: string }): Promise<ToolResult> {
      if (a.title === undefined && a.body === undefined) return err("Give a new title or new text.");
      if (a.title !== undefined && (!a.title.trim() || a.title.length > MAX_TITLE)) return err(`A title must be 1-${MAX_TITLE} characters.`);
      if (a.body !== undefined && (!a.body.trim() || a.body.length > MAX_BODY)) return err(`The text must be 1-${MAX_BODY} characters.`);
      const t = resolve(ctx, a.chat);
      if ("error" in t) return t.error;
      // Ask first: nothing about another chat is revealed (not even whether a note exists) before the user agrees.
      const refused = await gate(ctx, t, "edit");
      if (refused) return refused;
      const row = db.query("select id,title from notes where id=? and chat_id=? and user_id=?").get(a.id, t.chatId, ctx.userId) as { id: string; title: string } | null;
      if (!row) return err(`There is no note ${a.id} in ${t.cross ? `the chat "${t.title}"` : "this chat"}. Read the notes first to see their ids.`);
      db.run("update notes set title=coalesce(?,title), body=coalesce(?,body), updated_at=? where id=?", [a.title?.trim() ?? null, a.body ?? null, Date.now(), a.id]);
      const title = a.title?.trim() ?? row.title;
      hooks.emit(ctx.chatId, t.cross ? { kind: "edited", title, chat: t.title } : { kind: "edited", title });
      return { text: `Updated note ${a.id} "${title}".` };
    },
  };
}
export type Notes = ReturnType<typeof createNotes>;

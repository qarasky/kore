import type { Database } from "bun:sqlite";
import type { Activity, Attachment, ChatMessage, ChatSummary, SendMessageRequest, Source, StreamEvent } from "@koremind/shared";
import { hasSource } from "@koremind/shared";
import type { Engine, EngineFile, ModelRef } from "./engine/types";
import { CLOSED, IDLE, Pump } from "./engine/pump";
import { TITLE_SYSTEM, cleanTitle, titlePrompt } from "./title";
import { branchTo, newestLeafUnder, transcriptOf, variantsOf, type Node } from "./branch";

export type ChatsDeps = {
  buildSystem(userId: string): string;
  readUpload(id: string, userId: string): EngineFile | null;
  onTurnComplete(userId: string, userText: string, assistantText: string, model: ModelRef): void;
  /** The turn is over (finished, failed or stopped): approvals still waiting must close. */
  onTurnEnd?(chatId: string): void;
};

type ChatRow = { id: string; user_id: string; title: string; engine_session_id: string | null; leaf_id: string | null; updated_at: number };
type MsgRow = { id: string; chat_id: string; role: "user" | "assistant"; text: string; sources_json: string; activity_json: string | null; created_at: number; parent_id: string | null; session_id: string | null };
const node = (m: MsgRow): Node & { row: MsgRow } => ({ id: m.id, parentId: m.parent_id, role: m.role, text: m.text, createdAt: m.created_at, row: m });

/** A turn that runs on its own: it keeps going when the app disconnects, and an app can re-attach and replay it. */
class Turn {
  readonly events: StreamEvent[] = [];
  done = false;
  private wake = new Set<() => void>();
  push(ev: StreamEvent) { this.events.push(ev); this.notify(); }
  finish() { this.done = true; this.notify(); }
  private notify() { for (const w of [...this.wake]) w(); }
  /** Every event from the start, then live ones, until the turn ends or the caller stops reading. */
  async *follow(): AsyncGenerator<StreamEvent> {
    let i = 0;
    for (;;) {
      while (i < this.events.length) yield this.events[i++];
      if (this.done) return;
      await new Promise<void>((res) => { const w = () => { this.wake.delete(w); res(); }; this.wake.add(w); });
    }
  }
}

export class BusyError extends Error { constructor() { super("An answer is still being written in this chat."); } }
const summary = (r: ChatRow): ChatSummary => ({ id: r.id, title: r.title, updatedAt: r.updated_at });
const newId = () => crypto.randomUUID();

const TITLE_WAIT_MS = 8000;

export function createChats(db: Database, engine: Engine, deps: ChatsDeps) {
  const active = new Map<string, AbortController>();
  /** Events produced outside the engine stream while a turn runs (note activity, approval cards). */
  const side = new Map<string, Pump<StreamEvent>>();
  /** Best effort: a title typed by the owner meanwhile, or any failure, leaves things as they are. */
  const nameChat = async (chatId: string, placeholder: string, model: ModelRef, userText: string, assistantText: string): Promise<string | null> => {
    try {
      const title = cleanTitle(await engine.complete({ kind: "title", system: TITLE_SYSTEM, text: titlePrompt(userText, assistantText), model }));
      if (!title) return null;
      const r = db.run("update chats set title=? where id=? and title=?", [title, chatId, placeholder]);
      return r.changes > 0 ? title : null;
    } catch { return null; }
  };
  const row = (userId: string, chatId: string) =>
    db.query("select * from chats where id=? and user_id=?").get(chatId, userId) as ChatRow | null;
  const messagesOf = (chatId: string) =>
    (db.query("select * from messages where chat_id=? order by created_at, rowid").all(chatId) as MsgRow[]).map(node);
  /** The branch on screen. A chat from before branches without a leaf shows its newest message's branch. */
  const branchOf = (c: ChatRow, all = messagesOf(c.id)) => {
    const leaf = c.leaf_id ?? all.at(-1)?.id ?? null;
    return branchTo(leaf, new Map(all.map((m) => [m.id, m])));
  };
  const turns = new Map<string, Turn>();

  const api = {
    list(userId: string): ChatSummary[] {
      return (db.query("select * from chats where user_id=? order by updated_at desc, rowid desc").all(userId) as ChatRow[]).map(summary);
    },

    create(userId: string): ChatSummary {
      const r: ChatRow = { id: newId(), user_id: userId, title: "New chat", engine_session_id: null, updated_at: Date.now() };
      db.run("insert into chats(id,user_id,title,engine_session_id,model,updated_at) values(?,?,?,?,null,?)", [r.id, userId, r.title, null, r.updated_at]);
      return summary(r);
    },

    has: (userId: string, chatId: string) => !!row(userId, chatId),

    /** Pushes an event into the turn currently running for this chat. Dropped when no turn is running. */
    emit(chatId: string, ev: StreamEvent) { side.get(chatId)?.push(ev); },

    /** Which user and chat an engine session belongs to. */
    bySession(sessionId: string): { userId: string; chatId: string } | null {
      const r = (db.query("select id,user_id from chats where engine_session_id=?").get(sessionId)
        ?? db.query("select c.id,c.user_id from messages m join chats c on c.id=m.chat_id where m.session_id=? limit 1").get(sessionId)) as { id: string; user_id: string } | null;
      return r ? { userId: r.user_id, chatId: r.id } : null;
    },

    /** The chat with the messages of the branch on screen; edited user messages list their variants. */
    get(userId: string, chatId: string): { chat: ChatSummary; messages: ChatMessage[]; running: boolean } | null {
      const c = row(userId, chatId);
      if (!c) return null;
      const all = messagesOf(chatId);
      const atts = db.query("select a.* from attachments a join messages m on m.id=a.message_id where m.chat_id=?").all(chatId) as any[];
      const messages = branchOf(c, all).map(({ row: m }): ChatMessage => {
        const variants = m.role === "user" ? variantsOf(node(m), all) : [];
        return {
          id: m.id, role: m.role, text: m.text, createdAt: m.created_at, parentId: m.parent_id,
          sources: JSON.parse(m.sources_json),
          activity: JSON.parse(m.activity_json ?? "[]"),
          attachments: atts.filter((a) => a.message_id === m.id).map((a): Attachment => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
          ...(variants.length > 1 ? { siblings: variants } : {}),
        };
      });
      return { chat: summary(c), messages, running: turns.has(chatId) };
    },

    /** Shows another variant: the branch through [messageId], continued to its newest message. */
    branch(userId: string, chatId: string, messageId: string): boolean {
      const all = messagesOf(chatId);
      if (!row(userId, chatId) || !all.some((m) => m.id === messageId) || turns.has(chatId)) return false;
      db.run("update chats set leaf_id=? where id=?", [newestLeafUnder(messageId, all), chatId]);
      return true;
    },

    /** Whether an answer is being written in this chat right now. */
    running: (chatId: string) => turns.has(chatId),

    /**
     * Starts a turn that runs to the end even if nobody listens: closing the app or losing the connection no longer
     * stops the answer; only abort() does. Read it with follow().
     */
    start(userId: string, chatId: string, req: SendMessageRequest): Turn {
      if (turns.has(chatId)) throw new BusyError();
      const turn = new Turn();
      turns.set(chatId, turn);
      void (async () => {
        try { for await (const ev of api.send(userId, chatId, req, new AbortController().signal)) turn.push(ev); }
        catch (e) { turn.push({ type: "error", code: "engine", message: e instanceof Error ? e.message : "Engine error" }); }
        finally { turns.delete(chatId); turn.finish(); }
      })();
      return turn;
    },

    /** The running turn of this chat from its first event, or null when none is running. */
    follow(chatId: string): AsyncGenerator<StreamEvent> | null {
      return turns.get(chatId)?.follow() ?? null;
    },

    rename(userId: string, chatId: string, title: string) {
      db.run("update chats set title=? where id=? and user_id=?", [title.trim().slice(0, 120) || "New chat", chatId, userId]);
    },

    async remove(userId: string, chatId: string) {
      const c = row(userId, chatId);
      if (!c) return;
      active.get(chatId)?.abort();
      const sessions = new Set([c.engine_session_id, ...messagesOf(chatId).map((m) => m.row.session_id)].filter((x): x is string => !!x));
      for (const sid of sessions) await engine.deleteSession(sid).catch(() => {});
      db.run("delete from chats where id=?", [chatId]);
    },

    abort(chatId: string) {
      active.get(chatId)?.abort();
    },

    async *send(userId: string, chatId: string, req: SendMessageRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      const chat = row(userId, chatId);
      if (!chat) throw new Error("chat not found");
      const all = messagesOf(chatId);
      const prior = all.length;
      const onScreen = branchOf(chat, all);

      // Where the new message goes. An edit sits next to the message it replaces, in a fresh engine session that is told
      // the conversation before it; otherwise it follows the branch on screen in that branch's session.
      const edited = req.editOf ? all.find((m) => m.id === req.editOf && m.role === "user") : undefined;
      if (req.editOf && !edited) { yield { type: "error", code: "engine", message: "The message to edit was not found." }; return; }
      const parentId = edited ? edited.parentId : (onScreen.at(-1)?.id ?? null);
      const before = parentId ? branchTo(parentId, new Map(all.map((m) => [m.id, m]))) : [];
      const reuse = edited ? null : (onScreen.at(-1)?.row.session_id ?? (onScreen.length ? chat.engine_session_id : null));
      const attachmentIds = edited
        ? (db.query("select id from attachments where message_id=?").all(edited.id) as { id: string }[]).map((a) => a.id)
        : req.attachmentIds;

      const userMsgId = newId();
      const now = Date.now();
      db.run("insert into messages(id,chat_id,role,text,sources_json,created_at,parent_id) values(?,?,'user',?,'[]',?,?)", [userMsgId, chatId, req.text, now, parentId]);
      if (edited) {
        // The edited message keeps the original's files: new rows for the same stored files.
        for (const aid of attachmentIds) db.run("insert into attachments(id,user_id,message_id,name,mime,size,path) select ?,user_id,?,name,mime,size,path from attachments where id=?", [newId(), userMsgId, aid]);
      } else {
        for (const aid of attachmentIds) db.run("update attachments set message_id=? where id=? and user_id=?", [userMsgId, aid, userId]);
      }
      const placeholder = req.text.trim().slice(0, 48) || "New chat";
      db.run("update chats set updated_at=?, leaf_id=?, title=case when ?=0 then ? else title end where id=?", [now, userMsgId, prior, placeholder, chatId]);

      const files: EngineFile[] = [];
      for (const aid of attachmentIds) {
        const f = deps.readUpload(aid, userId);
        if (!f) { yield { type: "error", code: "engine", message: "An attachment could not be found." }; return; }
        files.push(f);
      }

      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal.addEventListener("abort", onAbort);
      active.set(chatId, ac);

      let text = "";
      const sources: Source[] = [];
      const activity: Activity[] = [];
      let assistantId: string | null = null;
      let finished = false;
      const save = () => {
        if (!text && !sources.length && !activity.length) return;
        if (!assistantId) {
          assistantId = newId();
          db.run("insert into messages(id,chat_id,role,text,sources_json,activity_json,created_at,parent_id,session_id) values(?,?,'assistant',?,?,?,?,?,?)", [assistantId, chatId, text, JSON.stringify(sources), JSON.stringify(activity), Date.now(), userMsgId, sessionId]);
          db.run("update chats set leaf_id=? where id=? and leaf_id=?", [assistantId, chatId, userMsgId]);
        } else {
          db.run("update messages set text=?, sources_json=?, activity_json=? where id=?", [text, JSON.stringify(sources), JSON.stringify(activity), assistantId]);
        }
        db.run("update chats set updated_at=? where id=?", [Date.now(), chatId]);
      };

      let sessionId: string | null = reuse;
      try {
        const fresh = !sessionId;
        if (!sessionId) sessionId = await engine.createSession(req.model);
        // The chat's current session lets the notes and memory tools find this chat.
        db.run("update chats set engine_session_id=? where id=?", [sessionId, chatId]);
        db.run("update messages set session_id=? where id=?", [sessionId, userMsgId]);
        const system = fresh ? [deps.buildSystem(userId), transcriptOf(before)].filter(Boolean).join("\n\n") : "";
        let sinceFlush = 0;
        const engineIt = engine.prompt({ sessionId, system, text: req.text, files, model: req.model, thinking: req.thinking, signal: ac.signal })[Symbol.asyncIterator]();
        const sidePump = new Pump<StreamEvent>(2_000_000_000);
        side.set(chatId, sidePump);
        let fromEngine = engineIt.next();
        let fromSide = sidePump.next();
        try {
          for (;;) {
            const got = await Promise.race([fromEngine.then((v) => ({ src: "engine" as const, v })), fromSide.then((v) => ({ src: "side" as const, v }))]);
            if (got.src === "side") {
              fromSide = sidePump.next();
              if (got.v === CLOSED || got.v === IDLE) continue;
              const ev = got.v;
              if (ev.type === "activity") activity.push({ kind: ev.kind, title: ev.title, ...(ev.chat ? { chat: ev.chat } : {}) });
              yield ev;
              continue;
            }
            if (got.v.done) break;
            const ev = got.v.value;
            fromEngine = engineIt.next();
            if (ev.type === "status") yield { type: "status", state: ev.state };
            else if (ev.type === "delta") {
              text += ev.text;
              if (++sinceFlush >= 20) { save(); sinceFlush = 0; }
              yield { type: "delta", text: ev.text };
            } else if (ev.type === "source") {
              // Engines repeat sources (twice, or with tracking parameters): keep and send each page once.
              if (hasSource(sources, ev)) continue;
              sources.push({ title: ev.title, url: ev.url });
              yield { type: "source", title: ev.title, url: ev.url };
            } else if (ev.type === "done") {
              save();
              finished = true;
              // Naming runs on the chosen model, concurrently with the finished answer. It must never delay or break the reply.
              const naming = prior === 0 ? nameChat(chatId, placeholder, req.model, req.text, text) : null;
              yield { type: "done", messageId: assistantId ?? newId() };
              try { deps.onTurnComplete(userId, req.text, text, req.model); } catch { /* memory must never break chat */ }
              if (naming) {
                const title = await Promise.race([naming, Bun.sleep(TITLE_WAIT_MS).then(() => null)]);
                if (title) yield { type: "title", title };
              }
              return;
            } else {
              save();
              finished = true;
              yield { type: "error", code: ev.noProvider ? "no_provider" : "engine", message: ev.message };
              return;
            }
          }
        } finally {
          side.delete(chatId);
          sidePump.close();
          void engineIt.return?.(undefined);
        }
        save();
        finished = true;
        yield ac.signal.aborted ? { type: "error", code: "aborted", message: "Stopped" } : { type: "error", code: "engine", message: "The engine ended the reply early." };
      } catch (e) {
        save();
        finished = true;
        yield { type: "error", code: "engine", message: e instanceof Error ? e.message : "Engine error" };
      } finally {
        if (!finished) save();
        active.delete(chatId);
        try { deps.onTurnEnd?.(chatId); } catch { /* never breaks chat */ }
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
  return api;
}
export type Chats = ReturnType<typeof createChats>;

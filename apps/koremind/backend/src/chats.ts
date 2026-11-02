import type { Database } from "bun:sqlite";
import type { Attachment, ChatMessage, ChatSummary, SendMessageRequest, Source, StreamEvent } from "@zero/shared";
import type { Engine, EngineFile } from "./engine/types";

export type ChatsDeps = {
  buildSystem(userId: string): string;
  readUpload(id: string, userId: string): EngineFile | null;
  onTurnComplete(userId: string, userText: string, assistantText: string): void;
  hasProvider(): Promise<boolean>;
};

type ChatRow = { id: string; user_id: string; title: string; engine_session_id: string | null; updated_at: number };
const summary = (r: ChatRow): ChatSummary => ({ id: r.id, title: r.title, updatedAt: r.updated_at });
const newId = () => crypto.randomUUID();

export function createChats(db: Database, engine: Engine, deps: ChatsDeps) {
  const active = new Map<string, AbortController>();
  const row = (userId: string, chatId: string) =>
    db.query("select * from chats where id=? and user_id=?").get(chatId, userId) as ChatRow | null;

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

    get(userId: string, chatId: string): { chat: ChatSummary; messages: ChatMessage[] } | null {
      const c = row(userId, chatId);
      if (!c) return null;
      const ms = db.query("select * from messages where chat_id=? order by created_at, rowid").all(chatId) as any[];
      const atts = db.query("select a.* from attachments a join messages m on m.id=a.message_id where m.chat_id=?").all(chatId) as any[];
      const messages = ms.map((m): ChatMessage => ({
        id: m.id, role: m.role, text: m.text, createdAt: m.created_at,
        sources: JSON.parse(m.sources_json),
        attachments: atts.filter((a) => a.message_id === m.id).map((a): Attachment => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
      }));
      return { chat: summary(c), messages };
    },

    rename(userId: string, chatId: string, title: string) {
      db.run("update chats set title=? where id=? and user_id=?", [title.trim().slice(0, 120) || "New chat", chatId, userId]);
    },

    async remove(userId: string, chatId: string) {
      const c = row(userId, chatId);
      if (!c) return;
      active.get(chatId)?.abort();
      if (c.engine_session_id) await engine.deleteSession(c.engine_session_id).catch(() => {});
      db.run("delete from chats where id=?", [chatId]);
    },

    abort(chatId: string) {
      active.get(chatId)?.abort();
    },

    async *send(userId: string, chatId: string, req: SendMessageRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
      const chat = row(userId, chatId);
      if (!chat) throw new Error("chat not found");
      const prior = (db.query("select count(*) c from messages where chat_id=?").get(chatId) as { c: number }).c;

      const userMsgId = newId();
      const now = Date.now();
      db.run("insert into messages(id,chat_id,role,text,sources_json,created_at) values(?,?,'user',?,'[]',?)", [userMsgId, chatId, req.text, now]);
      for (const aid of req.attachmentIds) db.run("update attachments set message_id=? where id=? and user_id=?", [userMsgId, aid, userId]);
      db.run("update chats set updated_at=?, title=case when ?=0 then ? else title end where id=?", [now, prior, req.text.trim().slice(0, 48) || "New chat", chatId]);

      if (!(await deps.hasProvider())) {
        yield { type: "error", code: "no_provider", message: "Connect a provider in Settings to start chatting." };
        return;
      }
      const files: EngineFile[] = [];
      for (const aid of req.attachmentIds) {
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
      let assistantId: string | null = null;
      let finished = false;
      const save = () => {
        if (!text && !sources.length) return;
        if (!assistantId) {
          assistantId = newId();
          db.run("insert into messages(id,chat_id,role,text,sources_json,created_at) values(?,?,'assistant',?,?,?)", [assistantId, chatId, text, JSON.stringify(sources), Date.now()]);
        } else {
          db.run("update messages set text=?, sources_json=? where id=?", [text, JSON.stringify(sources), assistantId]);
        }
        db.run("update chats set updated_at=? where id=?", [Date.now(), chatId]);
      };

      try {
        let sessionId = chat.engine_session_id;
        if (!sessionId) {
          sessionId = await engine.createSession(req.model);
          db.run("update chats set engine_session_id=? where id=?", [sessionId, chatId]);
        }
        const system = prior === 0 ? deps.buildSystem(userId) : "";
        let sinceFlush = 0;
        for await (const ev of engine.prompt({ sessionId, system, text: req.text, files, model: req.model, thinking: req.thinking, signal: ac.signal })) {
          if (ev.type === "status") yield { type: "status", state: ev.state };
          else if (ev.type === "delta") {
            text += ev.text;
            if (++sinceFlush >= 20) { save(); sinceFlush = 0; }
            yield { type: "delta", text: ev.text };
          } else if (ev.type === "source") {
            sources.push({ title: ev.title, url: ev.url });
            yield { type: "source", title: ev.title, url: ev.url };
          } else if (ev.type === "done") {
            save();
            finished = true;
            yield { type: "done", messageId: assistantId ?? newId() };
            try { deps.onTurnComplete(userId, req.text, text); } catch { /* memory must never break chat */ }
            return;
          } else {
            save();
            finished = true;
            yield { type: "error", code: ev.noProvider ? "no_provider" : "engine", message: ev.message };
            return;
          }
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
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
  return api;
}
export type Chats = ReturnType<typeof createChats>;

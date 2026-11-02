"use client";
import type { ChatMessage } from "@zero/shared";
import { FileText, Globe } from "lucide-react";
import { useEffect, useRef } from "react";
import { Markdown } from "./Markdown";
import type { Draft } from "@/lib/chat-state";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export function MessageList({ messages, draft }: { messages: ChatMessage[]; draft: Draft | null }) {
  const { api } = useSession();
  const end = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [messages, draft]);

  return (
    <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} m={m} api={api} /> : <Assistant key={m.id} text={m.text} sources={m.sources} />))}
        {draft && <Assistant text={draft.text} sources={draft.sources} status={draft.status} />}
        <div ref={end} />
      </div>
    </div>
  );
}

function UserBubble({ m, api }: { m: ChatMessage; api: ReturnType<typeof useSession>["api"] }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {m.attachments.map((a) => a.mime.startsWith("image/") && api
            ? <img key={a.id} src={api.uploadUrl(a.id)} alt={a.name} className="max-h-48 rounded-ui border border-border object-cover" />
            : <span key={a.id} className="flex items-center gap-1 rounded-ui bg-raised px-2 py-1 text-meta"><FileText size={14} aria-hidden />{a.name}</span>)}
        </div>
      )}
      {m.text && <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-raised px-4 py-2 text-heading">{m.text}</div>}
    </div>
  );
}

function Assistant({ text, sources, status }: { text: string; sources: { title: string; url: string }[]; status?: Draft["status"] }) {
  return (
    <div className="flex flex-col gap-3">
      {status && (
        <div className="flex items-center gap-2 text-meta text-muted" role="status">
          {status === "searching" ? <Globe size={14} aria-hidden /> : null}
          <span>{status === "searching" ? t.searching : t.thinking}</span>
          <span className="dot-pulse" aria-hidden><i /><i /><i /></span>
        </div>
      )}
      {text && <Markdown text={text} />}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="sr-only">{t.sources}</span>
          {sources.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="flex max-w-60 items-center gap-1 rounded-ui border border-border px-2 py-1 text-2xs text-muted hover:text-text">
              <Globe size={12} aria-hidden /><span className="truncate">{s.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

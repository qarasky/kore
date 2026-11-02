"use client";
import type { Activity, ChatMessage } from "@zero/shared";
import { BookOpen, FileText, Globe, Lock, Pencil, StickyNote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Markdown } from "./Markdown";
import type { Draft } from "@/lib/chat-state";
import { Button } from "./ui";
import { activityText, approvalText, type PendingApproval } from "@/lib/notes-ui";
import { fadeUp, quick } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export function MessageList({ messages, draft, onApproval }: { messages: ChatMessage[]; draft: Draft | null; onApproval(id: string, allow: boolean): void }) {
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
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div key={m.id} variants={fadeUp} initial="hidden" animate="show">
              {m.role === "user" ? <UserBubble m={m} api={api} /> : <Assistant text={m.text} sources={m.sources} activity={m.activity} />}
            </motion.div>
          ))}
          {draft && <motion.div key="draft" variants={fadeUp} initial="hidden" animate="show"><Assistant text={draft.text} sources={draft.sources} status={draft.status} activity={draft.activity} approvals={draft.approvals} expired={draft.expired} onApproval={onApproval} /></motion.div>}
        </AnimatePresence>
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

const ACTIVITY_ICON = { saved: StickyNote, edited: Pencil, read: BookOpen, denied: Lock } as const;

function Assistant({ text, sources, status, activity = [], approvals = [], expired = false, onApproval }: { text: string; sources: { title: string; url: string }[]; status?: Draft["status"]; activity?: Activity[]; approvals?: PendingApproval[]; expired?: boolean; onApproval?(id: string, allow: boolean): void }) {
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="wait">
        {status && (
          <motion.div key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} className="flex items-center gap-2 text-meta text-muted" role="status">
            {status === "searching" ? <Globe size={14} aria-hidden /> : null}
            <span>{status === "searching" ? t.searching : t.thinking}</span>
            <span className="dot-pulse" aria-hidden><i /><i /><i /></span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {approvals.map((a) => (
          <motion.div key={a.id} layout initial={{ opacity: 0, y: 8, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={quick} className="overflow-hidden" role="alertdialog" aria-label={approvalText(a)}>
            <div className="rounded-ui border border-warning/40 bg-surface p-3">
              <p className="text-sub">{approvalText(a)}</p>
              <div className="mt-3 flex gap-2">
                <Button onClick={() => onApproval?.(a.id, true)}>{t.approvalAllow}</Button>
                <Button variant="ghost" onClick={() => onApproval?.(a.id, false)}>{t.approvalDeny}</Button>
              </div>
            </div>
          </motion.div>
        ))}
        {expired && approvals.length === 0 && <motion.p key="expired" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quick} className="text-meta text-muted" role="status">{t.approvalExpired}</motion.p>}
      </AnimatePresence>
      {activity.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activity.map((a, i) => {
            const Icon = ACTIVITY_ICON[a.kind];
            return (
              <motion.span key={`${a.kind}-${a.title}-${a.chat ?? ""}-${i}`} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i, 6) * 0.04, duration: 0.18 }} className={`flex max-w-72 items-center gap-1 rounded-ui border border-border px-2 py-1 text-2xs ${a.kind === "denied" ? "text-danger" : "text-muted"}`}>
                <Icon size={12} aria-hidden /><span className="truncate">{activityText(a)}</span>
              </motion.span>
            );
          })}
        </div>
      )}
      {text && <Markdown text={text} />}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="sr-only">{t.sources}</span>
          {sources.map((s, i) => (
            <motion.a key={s.url} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04, duration: 0.18 }} href={s.url} target="_blank" rel="noopener noreferrer" className="flex max-w-60 items-center gap-1 rounded-ui border border-border px-2 py-1 text-2xs text-muted hover:text-text">
              <Globe size={12} aria-hidden /><span className="truncate">{s.title}</span>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import type { Activity, ChatMessage } from "@koremind/shared";
import { Badge, Button, Card, badgeVariants, cn } from "@qarasky/kore-ui";
import { BookOpen, FileText, Globe, Lock, Pencil, StickyNote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Markdown } from "./Markdown";
import type { Draft } from "@/lib/chat-state";
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
      <div className="mx-auto flex w-full max-w-reading flex-col gap-6 px-4 py-6">
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
            ? <img key={a.id} src={api.uploadUrl(a.id)} alt={a.name} className="max-h-48 rounded-overlay border border-border object-cover" />
            : <span key={a.id} className="flex h-control-sm items-center gap-1.5 rounded-ui border border-border bg-raised px-2 text-meta"><FileText className="size-4 text-muted" aria-hidden />{a.name}</span>)}
        </div>
      )}
      {m.text && <div className="max-w-[85%] whitespace-pre-wrap rounded-overlay bg-raised px-4 py-2.5">{m.text}</div>}
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
            {status === "searching" ? <Globe className="size-4" aria-hidden /> : null}
            <span>{status === "searching" ? t.searching : t.thinking}</span>
            <span className="dot-pulse" aria-hidden><i /><i /><i /></span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {approvals.map((a) => (
          <motion.div key={a.id} layout initial={{ opacity: 0, y: 8, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={quick} className="overflow-hidden" role="alertdialog" aria-label={approvalText(a)}>
            <Card className="border-warning/40 p-4">
              <p>{approvalText(a)}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" size="sm" onClick={() => onApproval?.(a.id, true)}>{t.approvalAllow}</Button>
                <Button size="sm" onClick={() => onApproval?.(a.id, false)}>{t.approvalDeny}</Button>
              </div>
            </Card>
          </motion.div>
        ))}
        {expired && approvals.length === 0 && <motion.p key="expired" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={quick} className="text-meta text-muted" role="status">{t.approvalExpired}</motion.p>}
      </AnimatePresence>
      {activity.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {activity.map((a, i) => {
            const Icon = ACTIVITY_ICON[a.kind];
            return (
              <motion.span key={`${a.kind}-${a.title}-${a.chat ?? ""}-${i}`} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i, 6) * 0.04, duration: 0.14 }} className="flex max-w-72">
                <Badge tone={a.kind === "denied" ? "danger" : "outline"} className="max-w-full"><Icon aria-hidden /><span className="truncate">{activityText(a)}</span></Badge>
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
            <motion.a key={s.url} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04, duration: 0.14 }} href={s.url} target="_blank" rel="noopener noreferrer" className={cn(badgeVariants({ tone: "outline" }), "max-w-60 hover:border-accent/60 hover:text-text")}>
              <Globe aria-hidden /><span className="truncate">{s.title}</span>
            </motion.a>
          ))}
        </div>
      )}
    </div>
  );
}

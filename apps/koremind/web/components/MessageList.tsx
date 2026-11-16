"use client";
import { dedupeSources, sourceHost, type Activity, type ChatMessage } from "@koremind/shared";
import { Alert, Badge, Button, CopyButton, IconButton, Textarea, badgeVariants, cn } from "@qarasky/kore-ui";
import { BookOpen, Brain, BrainCircuit, ChevronDown, ChevronLeft, ChevronRight, FileText, Globe, Lock, Pencil, RefreshCw, StickyNote, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type UIEvent, type WheelEvent } from "react";
import { Markdown } from "./Markdown";
import { variantAt, variantPosition, type Draft } from "@/lib/chat-state";
import { followStep, nextFollowing } from "@/lib/chat-scroll";
import { activityText, approvalText, type PendingApproval } from "@/lib/notes-ui";
import { fadeUp, quick } from "@/lib/motion";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

export function MessageList({ messages, draft, busy, onApproval, onEdit, onVariant }: {
  messages: ChatMessage[]; draft: Draft | null; busy: boolean;
  onApproval(id: string, allow: boolean): void; onEdit(id: string, text: string): void; onVariant(id: string): void;
}) {
  const { api } = useSession();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true); // keep the newest text in view
  const held = useRef(false); // a finger or the scrollbar is on the list: never scroll under it
  const lastTop = useRef(0);
  const frame = useRef(0);

  // Ease towards the bottom frame by frame while following, instead of snapping on every token.
  const kick = useCallback(() => {
    if (frame.current || !follow.current || held.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      frame.current = 0;
      const el = scroller.current;
      if (!el || !follow.current || held.current) return;
      const step = followStep(el.scrollHeight - el.clientHeight - el.scrollTop, el.clientHeight, now - last);
      last = now;
      if (step > 0) { el.scrollTop += step; lastTop.current = el.scrollTop; }
      if (el.scrollHeight - el.clientHeight - el.scrollTop >= 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, []);

  // Any growth of the content (tokens, cards, images loading) moves the list along.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(kick);
    ro.observe(el);
    const release = () => { if (held.current) { held.current = false; kick(); } };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => { ro.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); };
  }, [kick]);

  // Opening another chat starts at its end.
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    follow.current = true;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [firstId]);

  // Sending a message always brings you back to the bottom.
  const lastRole = messages[messages.length - 1]?.role;
  useEffect(() => {
    if (lastRole === "user") { follow.current = true; kick(); }
  }, [messages.length, lastRole, kick]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const movedUp = el.scrollTop < lastTop.current - 1;
    lastTop.current = el.scrollTop;
    follow.current = nextFollowing(follow.current, el.scrollHeight - el.clientHeight - el.scrollTop, movedUp);
    if (follow.current) kick();
  };
  // Stop following before the browser starts its own (smooth) scroll, so the two never fight.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => { if (e.deltaY < 0) follow.current = false; };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => { if (["ArrowUp", "PageUp", "Home"].includes(e.key)) follow.current = false; };
  const hold = () => { held.current = true; };
  const letGo = () => { held.current = false; kick(); };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onTouchStart={hold}
      onTouchEnd={letGo}
      onTouchCancel={letGo}
      onPointerDown={(e) => { if (e.target === e.currentTarget) hold(); }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div ref={content} className="mx-auto flex w-full max-w-reading flex-col gap-6 px-4 py-6">
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div key={m.id} variants={fadeUp} initial="hidden" animate="show">
              {m.role === "user" ? <UserBubble m={m} api={api} busy={busy} onEdit={onEdit} onVariant={onVariant} /> : <Assistant text={m.text} sources={m.sources} activity={m.activity} />}
            </motion.div>
          ))}
          {draft && <motion.div key="draft" variants={fadeUp} initial="hidden" animate="show"><Assistant text={draft.text} sources={draft.sources} status={draft.status} activity={draft.activity} approvals={draft.approvals} expired={draft.expired} live onApproval={onApproval} /></motion.div>}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Your message. Copy and Edit sit under it (on hover, always on touch screens); an edited message can switch between its versions. */
function UserBubble({ m, api, busy, onEdit, onVariant }: { m: ChatMessage; api: ReturnType<typeof useSession>["api"]; busy: boolean; onEdit(id: string, text: string): void; onVariant(id: string): void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const saved = !m.id.startsWith("local-");
  const position = variantPosition(m);
  const submit = () => {
    const text = editing?.trim();
    if (!text || busy) return;
    setEditing(null);
    if (text !== m.text.trim()) onEdit(m.id, text);
  };
  return (
    <div className="group flex flex-col items-end gap-2">
      {m.attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {m.attachments.map((a) => a.mime.startsWith("image/") && api
            ? <img key={a.id} src={api.uploadUrl(a.id)} alt={a.name} className="max-h-48 rounded-overlay border border-border object-cover" />
            : <span key={a.id} className="flex h-control-sm items-center gap-1.5 rounded-ui border border-border bg-raised px-2 text-meta"><FileText className="size-4 text-muted" aria-hidden />{a.name}</span>)}
        </div>
      )}
      {editing !== null ? (
        <div className="flex w-full max-w-[85%] flex-col gap-2 rounded-overlay border border-accent bg-raised p-2">
          <Textarea
            autoFocus autoGrow maxHeight={200} rows={2} value={editing} aria-label={t.editMessage}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
            className="rounded-none border-0 bg-transparent px-2 hover:border-0 focus:border-0 focus:ring-0"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setEditing(null)}>{t.cancel}</Button>
            <Button size="sm" variant="primary" disabled={busy || !editing.trim()} onClick={submit}>{t.send}</Button>
          </div>
        </div>
      ) : m.text && <div className="max-w-[85%] whitespace-pre-wrap rounded-overlay border border-border bg-raised px-4 py-2.5">{m.text}</div>}
      {editing === null && (
        <div className="flex items-center gap-0.5 text-muted">
          {position && (
            <span className="mr-1 flex items-center text-meta tabular-nums">
              <IconButton label={t.previousVersion} icon={<ChevronLeft />} tooltip={false} className="size-7" disabled={busy || position.index === 1} onClick={() => { const id = variantAt(m, -1); if (id) onVariant(id); }} />
              <span aria-label={t.versionOf(position.index, position.count)}>{position.index} / {position.count}</span>
              <IconButton label={t.nextVersion} icon={<ChevronRight />} tooltip={false} className="size-7" disabled={busy || position.index === position.count} onClick={() => { const id = variantAt(m, 1); if (id) onVariant(id); }} />
            </span>
          )}
          <span className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            {m.text && <CopyButton value={m.text} iconOnly label={t.copy} copiedLabel={t.copied} failedLabel={t.copyFailed} variant="ghost" className="size-7" />}
            {saved && m.text && <IconButton label={t.editMessage} icon={<Pencil />} tooltip={false} className="size-7" disabled={busy} onClick={() => setEditing(m.text)} />}
          </span>
        </div>
      )}
    </div>
  );
}

const ACTIVITY_ICON = { saved: StickyNote, edited: Pencil, read: BookOpen, denied: Lock, memory_saved: Brain, memory_updated: Brain, memory_read: BrainCircuit, memory_deleted: Trash2 } as const satisfies Record<Activity["kind"], unknown>;

function Assistant({ text, sources, status, activity = [], approvals = [], expired = false, live = false, onApproval }: { text: string; live?: boolean; sources: { title: string; url: string }[]; status?: Draft["status"]; activity?: Activity[]; approvals?: PendingApproval[]; expired?: boolean; onApproval?(id: string, allow: boolean): void }) {
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="wait">
        {status && (
          <motion.div key={status} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }} className="flex items-center gap-2 text-meta text-muted" role="status">
            {status === "searching" ? <Globe className="size-4" aria-hidden /> : status === "reconnecting" ? <RefreshCw className="size-4" aria-hidden /> : null}
            <span>{status === "searching" ? t.searching : status === "reconnecting" ? t.reconnecting : t.thinking}</span>
            <span className="dot-pulse" aria-hidden><i /><i /><i /></span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {approvals.map((a) => (
          <motion.div key={a.id} layout initial={{ opacity: 0, y: 8, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={quick} className="overflow-hidden" role="alertdialog" aria-label={approvalText(a)}>
            <Alert
              tone="warning"
              action={
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => onApproval?.(a.id, true)}>{t.approvalAllow}</Button>
                  <Button size="sm" onClick={() => onApproval?.(a.id, false)}>{t.approvalDeny}</Button>
                </div>
              }
            >
              {approvalText(a)}
            </Alert>
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
      {text && <Markdown text={text} live={live} />}
      {sources.length > 0 && <Sources sources={sources} />}
    </div>
  );
}

/** Search sources, folded under one "Sources" row so they never push the answer away. */
function Sources({ sources }: { sources: { title: string; url: string }[] }) {
  const list = dedupeSources(sources);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex h-control-sm items-center gap-1.5 rounded-ui px-1 text-meta text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <Globe className="size-4" aria-hidden />
        <span>{t.sourcesCount(list.length)}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul id={id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={quick} className="mt-1 overflow-hidden rounded-ui border border-border">
            {list.map((s) => (
              <li key={s.url} className="border-b border-border last:border-b-0">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-baseline gap-2 px-3 py-2 hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate">{s.title || sourceHost(s.url)}</span>
                  <span className="shrink-0 text-meta text-muted">{sourceHost(s.url)}</span>
                </a>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

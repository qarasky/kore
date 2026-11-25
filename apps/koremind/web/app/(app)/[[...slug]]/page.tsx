"use client";
import type { Attachment, StreamEvent } from "@koremind/shared";
import { Alert, Button, IconButton, InlineMessage, PageHeader } from "@qarasky/kore-ui";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { SquarePen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";
import { applyEvent, beginEdit, beginTurn, emptyChat, needsLoad, reconnecting, restartDraft, withServerMessages, type ChatState } from "@/lib/chat-state";
import { useChats, useModelChoice } from "@/lib/contexts";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

// A new chat stays on "/" while it streams. When the answer ends we switch the URL to /c/<id>, which remounts this page;
// the finished state is handed over here so the screen does not flash or refetch.
let handoff: { id: string; state: ChatState } | null = null;

export default function ChatScreen() {
  const { api } = useSession();
  const { choice } = useModelChoice();
  const { chats, refresh } = useChats();
  const router = useRouter();
  const slug = useParams<{ slug?: string[] }>().slug;
  const urlChatId = slug?.[0] === "c" ? (slug[1] ?? null) : null;

  const initial = useRef(handoff && handoff.id === urlChatId ? handoff : null);
  const [state, setState] = useState<ChatState>(initial.current?.state ?? emptyChat);
  const stateRef = useRef(state);
  const update = useCallback((fn: (s: ChatState) => ChatState) => { stateRef.current = fn(stateRef.current); setState(stateRef.current); }, []);
  const [busy, setBusy] = useState(false);
  const chatId = useRef<string | null>(initial.current?.id ?? null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { handoff = null; }, []);

  /** The chat as the server has it: real ids and variants after a turn, or the answer that finished while we were away. */
  const reload = useCallback(async (id: string) => {
    const r = await api?.chat(id).catch(() => null);
    if (r && chatId.current === id) update((s) => withServerMessages(s, r.messages));
    return r;
  }, [api, update]);

  /** Reads a turn's events into the screen. "dropped" when the connection broke before the answer ended. */
  const read = useCallback(async (events: AsyncIterable<StreamEvent>): Promise<"ended" | "dropped"> => {
    for await (const ev of events) {
      if (ev.type === "error" && ev.code === "network") { update(reconnecting); return "dropped"; }
      update((s) => applyEvent(s, ev));
      // The stream stays open a moment after `done` for the generated title; the composer must not wait for it.
      if (ev.type === "done" || ev.type === "error") setBusy(false);
      if (ev.type === "title") void refresh();
    }
    return "ended";
  }, [refresh, update]);

  /**
   * The answer keeps running on the server when the connection drops (switching apps, a network change). Re-attach to it,
   * waiting a little longer each time, until it ends or the user leaves the chat; then show what the server saved.
   */
  const resume = useCallback(async (id: string, ac: AbortController) => {
    for (let attempt = 0; chatId.current === id && !ac.signal.aborted; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 10_000)));
      if (chatId.current !== id || ac.signal.aborted) return;
      try {
        const events = await api?.follow(id, ac.signal);
        if (!events) break; // finished meanwhile
        update(restartDraft);
        if ((await read(events)) === "ended") break;
      } catch { /* offline: try again */ }
    }
    if (chatId.current === id && !ac.signal.aborted) await reload(id);
    setBusy(false);
  }, [api, read, reload, update]);

  // Load a chat when the URL points at a different one than the one on screen; pick up an answer still being written.
  useEffect(() => {
    if (!needsLoad(urlChatId, chatId.current)) return;
    abort.current?.abort();
    setBusy(false);
    chatId.current = urlChatId;
    if (!urlChatId) { update(() => emptyChat); return; }
    api?.chat(urlChatId).then((r) => {
      if (chatId.current !== urlChatId) return;
      update(() => ({ ...emptyChat, messages: r.messages }));
      if (r.running) {
        const ac = new AbortController();
        abort.current = ac;
        setBusy(true);
        update(reconnecting);
        void resume(urlChatId, ac);
      }
    }).catch(() => router.replace("/"));
  }, [urlChatId, api, router, update, resume]);

  /** Sends a message, or with [editOf] replaces that message with a new variant. */
  const send = useCallback(async (text: string, attachments: Attachment[], editOf?: string) => {
    if (!api || !choice) return;
    update((s) => (editOf ? beginEdit(s, editOf, text) : beginTurn(s, text, attachments)));
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let created = false;
    try {
      if (!chatId.current) {
        chatId.current = (await api.createChat()).id;
        created = true;
      }
      const id = chatId.current;
      const body = { text, attachmentIds: editOf ? [] : attachments.map((a) => a.id), model: { providerId: choice.providerId, modelId: choice.modelId }, thinking: choice.thinking, ...(editOf ? { editOf } : {}) };
      if ((await read(api.send(id, body, ac.signal))) === "dropped") await resume(id, ac);
      else if (!ac.signal.aborted) await reload(id);
    } catch (e) {
      update((s) => applyEvent(s, { type: "error", code: "engine", message: e instanceof Error ? e.message : t.genericError }));
    } finally {
      setBusy(false);
      void refresh();
      if (created && chatId.current && !ac.signal.aborted) {
        handoff = { id: chatId.current, state: stateRef.current };
        router.replace(`/c/${chatId.current}`);
      }
    }
  }, [api, choice, refresh, router, update, read, resume, reload]);

  const edit = useCallback((messageId: string, text: string) => { void send(text, [], messageId); }, [send]);

  /** Shows another version of an edited message and the conversation that follows it. */
  const showVariant = useCallback(async (messageId: string) => {
    const id = chatId.current;
    if (!api || !id || busy) return;
    const r = await api.branch(id, messageId).catch(() => null);
    if (r && chatId.current === id) update((s) => ({ ...withServerMessages(s, r.messages), error: null }));
  }, [api, busy, update]);

  const answerApproval = useCallback((id: string, allow: boolean) => {
    // The card goes away the moment it is tapped; the server's approval_closed confirms.
    update((s) => applyEvent(s, { type: "approval_closed", id, outcome: allow ? "allowed" : "denied" }));
    if (chatId.current) void api?.answerApproval(chatId.current, id, allow).catch(() => {});
  }, [api, update]);

  const stop = useCallback(() => {
    abort.current?.abort();
    update((s) => (s.draft ? applyEvent(s, { type: "error", code: "aborted", message: "Stopped" }) : s));
    if (chatId.current) void api?.abort(chatId.current).catch(() => {});
  }, [api, update]);

  const title = chats.find((c) => c.id === chatId.current)?.title ?? t.appName;
  const empty = state.messages.length === 0 && !state.draft;



  return (
    <>
      <PageHeader
        title={empty ? t.newChat : title}
        actions={!empty ? <IconButton label={t.newChat} icon={<SquarePen />} onClick={() => router.push("/")} /> : null}
      />
      {empty ? (
        <div className="flex flex-1 items-center justify-center px-6"><motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} className="text-display font-semibold tracking-[-0.01em]">{t.homeGreeting}</motion.p></div>
      ) : (
        <MessageList messages={state.messages} draft={state.draft} busy={busy} onApproval={answerApproval} onEdit={edit} onVariant={showVariant} />
      )}
      {state.connectProvider && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mb-2 w-full max-w-reading px-4">
          <Alert tone="warning" title={t.connectProvider} action={<Button asChild size="sm"><Link href="/settings#providers">{t.openSettings}</Link></Button>}>
            {t.connectProviderHint}
          </Alert>
        </motion.div>
      )}
      {state.error && !state.connectProvider && <div className="mx-auto mb-2 w-full max-w-reading px-4"><InlineMessage animated>{state.error.message}</InlineMessage></div>}
      <Composer busy={busy} onSend={send} onStop={stop} />
    </>
  );
}

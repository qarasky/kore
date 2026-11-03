"use client";
import type { Attachment } from "@koremind/shared";
import { Button, Card, ConfirmDialog, IconButton, PageHeader } from "@qarasky/kore-ui";
import { motion } from "motion/react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "@/components/Composer";
import { InlineError } from "@/components/InlineError";
import { MessageList } from "@/components/MessageList";
import { applyEvent, beginTurn, emptyChat, needsLoad, type ChatState } from "@/lib/chat-state";
import { useChats, useModelChoice } from "@/lib/contexts";
import { useSession } from "@/lib/session";
import { t } from "@/lib/strings";

// A new chat stays on "/" while it streams. When the answer ends we switch the URL to /c/<id>, which remounts this page;
// the finished state is handed over here so the screen does not flash or refetch.
let handoff: { id: string; state: ChatState } | null = null;

export default function ChatScreen() {
  const { api } = useSession();
  const { choice } = useModelChoice();
  const { chats, refresh, remove } = useChats();
  const router = useRouter();
  const slug = useParams<{ slug?: string[] }>().slug;
  const urlChatId = slug?.[0] === "c" ? (slug[1] ?? null) : null;

  const initial = useRef(handoff && handoff.id === urlChatId ? handoff : null);
  const [state, setState] = useState<ChatState>(initial.current?.state ?? emptyChat);
  const stateRef = useRef(state);
  const update = useCallback((fn: (s: ChatState) => ChatState) => { stateRef.current = fn(stateRef.current); setState(stateRef.current); }, []);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chatId = useRef<string | null>(initial.current?.id ?? null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { handoff = null; }, []);

  // Load a chat when the URL points at a different one than the one on screen.
  useEffect(() => {
    if (!needsLoad(urlChatId, chatId.current)) return;
    abort.current?.abort();
    setBusy(false);
    chatId.current = urlChatId;
    if (!urlChatId) { update(() => emptyChat); return; }
    api?.chat(urlChatId).then((r) => update(() => ({ ...emptyChat, messages: r.messages }))).catch(() => router.replace("/"));
  }, [urlChatId, api, router, update]);

  const send = useCallback(async (text: string, attachments: Attachment[]) => {
    if (!api || !choice) return;
    update((s) => beginTurn(s, text, attachments));
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let created = false;
    try {
      if (!chatId.current) {
        chatId.current = (await api.createChat()).id;
        created = true;
      }
      for await (const ev of api.send(chatId.current, { text, attachmentIds: attachments.map((a) => a.id), model: { providerId: choice.providerId, modelId: choice.modelId }, thinking: choice.thinking }, ac.signal)) {
        update((s) => applyEvent(s, ev));
        // The stream stays open a moment after `done` for the generated title; the composer must not wait for it.
        if (ev.type === "done") setBusy(false);
        if (ev.type === "title") void refresh();
      }
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
  }, [api, choice, refresh, router, update]);

  const answerApproval = useCallback((id: string, allow: boolean) => {
    // The card goes away the moment it is tapped; the server's approval_closed confirms.
    update((s) => applyEvent(s, { type: "approval_closed", id, outcome: allow ? "allowed" : "denied" }));
    if (chatId.current) void api?.answerApproval(chatId.current, id, allow).catch(() => {});
  }, [api, update]);

  const stop = useCallback(() => {
    abort.current?.abort();
    if (chatId.current) void api?.abort(chatId.current).catch(() => {});
  }, [api]);

  const title = chats.find((c) => c.id === chatId.current)?.title ?? t.appName;
  const empty = state.messages.length === 0 && !state.draft;

  const deleteChat = async () => {
    const id = chatId.current!;
    chatId.current = null;
    update(() => emptyChat);
    await remove(id);
    router.push("/");
  };

  return (
    <>
      <PageHeader
        title={empty ? t.newChat : title}
        actions={chatId.current && !empty ? <IconButton label={t.deleteChat} icon={<Trash2 />} variant="danger" onClick={() => setConfirmDelete(true)} /> : null}
      />
      <ConfirmDialog
        open={confirmDelete} onOpenChange={setConfirmDelete} danger
        title={t.deleteChatTitle(title)} description={t.deleteChatBody}
        confirmLabel={t.delete} cancelLabel={t.cancel} pendingLabel={t.deleting} onConfirm={deleteChat}
      />
      {empty ? (
        <div className="flex flex-1 items-center justify-center px-6"><motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }} className="text-display font-semibold tracking-[-0.01em]">{t.homeGreeting}</motion.p></div>
      ) : (
        <MessageList messages={state.messages} draft={state.draft} onApproval={answerApproval} />
      )}
      {state.connectProvider && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mb-2 w-full max-w-reading px-4">
          <Card className="border-warning/40 p-4">
            <p className="font-medium">{t.connectProvider}</p>
            <p className="mt-1 text-meta text-muted">{t.connectProviderHint}</p>
            <Button asChild size="sm" className="mt-3"><Link href="/settings#providers">{t.openSettings}</Link></Button>
          </Card>
        </motion.div>
      )}
      {state.error && !state.connectProvider && <div className="mx-auto mb-2 w-full max-w-reading px-4"><InlineError>{state.error.message}</InlineError></div>}
      <Composer busy={busy} onSend={send} onStop={stop} />
    </>
  );
}

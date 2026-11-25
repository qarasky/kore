import { addSource, type Activity, type Attachment, type ChatMessage, type Source, type StreamEvent } from "@koremind/shared";
import type { PendingApproval } from "./notes-ui";

export type Draft = { text: string; sources: Source[]; status: "thinking" | "searching" | "reconnecting" | null; activity: Activity[]; approvals: PendingApproval[]; expired: boolean };
const freshDraft = (): Draft => ({ text: "", sources: [], status: "thinking", activity: [], approvals: [], expired: false });
export type ChatState = {
  messages: ChatMessage[];
  draft: Draft | null;
  error: { code: string; message: string } | null;
  connectProvider: boolean;
};
export const emptyChat: ChatState = { messages: [], draft: null, error: null, connectProvider: false };

const localId = () => `local-${crypto.randomUUID()}`;

/** Called the instant the user sends: shows their message and a thinking indicator before any network response. */
export function beginTurn(s: ChatState, text: string, attachments: Attachment[]): ChatState {
  return {
    messages: [...s.messages, { id: localId(), role: "user", text, attachments, sources: [], activity: [], createdAt: Date.now() }],
    draft: freshDraft(),
    error: null,
    connectProvider: false,
  };
}

/**
 * Editing a user message: everything from it on leaves the screen, the new text takes its place (with the original's
 * files) and a new answer starts. The server keeps the old version as a variant.
 */
export function beginEdit(s: ChatState, messageId: string, text: string): ChatState {
  const i = s.messages.findIndex((m) => m.id === messageId && m.role === "user");
  if (i < 0) return s;
  return beginTurn({ ...s, messages: s.messages.slice(0, i) }, text, s.messages[i].attachments);
}

/** The connection broke mid-answer: keep what arrived and say we are reconnecting. The answer goes on on the server. */
export const reconnecting = (s: ChatState): ChatState => ({ ...s, draft: { ...(s.draft ?? freshDraft()), status: "reconnecting" } });

/** Re-attached to the running answer, which replays from its first event: start the draft over. */
export const restartDraft = (s: ChatState): ChatState => ({ ...s, draft: freshDraft() });

/** The chat as the server has it (real ids, variants), keeping an error shown for the last turn. */
export const withServerMessages = (s: ChatState, messages: ChatMessage[]): ChatState => ({ ...s, messages, draft: null });

/** "2 / 3" for an edited message, or null when it has a single version. */
export function variantPosition(m: ChatMessage): { index: number; count: number } | null {
  const list = m.siblings ?? [];
  const i = list.indexOf(m.id);
  return list.length > 1 && i >= 0 ? { index: i + 1, count: list.length } : null;
}

/** The variant [step] away (-1 previous, +1 next), or null at either end. */
export function variantAt(m: ChatMessage, step: number): string | null {
  const list = m.siblings ?? [];
  const i = list.indexOf(m.id);
  return i >= 0 ? (list[i + step] ?? null) : null;
}

export function applyEvent(s: ChatState, ev: StreamEvent): ChatState {
  const d = s.draft ?? { ...freshDraft(), status: null };
  switch (ev.type) {
    case "status":
      return { ...s, draft: { ...d, status: ev.state } };
    case "delta":
      return { ...s, draft: { ...d, text: d.text + ev.text, status: null } };
    case "source":
      return { ...s, draft: { ...d, sources: addSource(d.sources, { title: ev.title, url: ev.url }) } };
    case "activity":
      return { ...s, draft: { ...d, activity: [...d.activity, { kind: ev.kind, title: ev.title, ...(ev.chat ? { chat: ev.chat } : {}) }] } };
    case "approval":
      return { ...s, draft: { ...d, approvals: [...d.approvals, { id: ev.id, action: ev.action, chat: ev.chat }] } };
    case "approval_closed":
      return { ...s, draft: { ...d, approvals: d.approvals.filter((a) => a.id !== ev.id), expired: d.expired || ev.outcome === "expired" } };
    case "done":
      return {
        ...s,
        draft: null,
        messages: [...s.messages, { id: ev.messageId, role: "assistant", text: d.text, attachments: [], sources: d.sources, activity: d.activity, createdAt: Date.now() }],
      };
    case "title":
      return s; // the chat list shows it; the transcript is unchanged
    case "error": {
      if (ev.code === "network") return reconnecting(s);
      const partial = d.text || d.sources.length || d.activity.length
        ? [...s.messages, { id: localId(), role: "assistant" as const, text: d.text, attachments: [], sources: d.sources, activity: d.activity, createdAt: Date.now() }]
        : s.messages;
      return { messages: partial, draft: null, error: ev.code === "aborted" ? null : { code: ev.code, message: ev.message }, connectProvider: ev.code === "no_provider" };
    }
  }
}

/** True when the URL points at a different chat than the one on screen. */
export const needsLoad = (urlChatId: string | null, shownChatId: string | null) => urlChatId !== shownChatId;

export function canSend(a: { text: string; fileCount: number; uploading: number; busy: boolean; hasModel: boolean }): boolean {
  return a.hasModel && !a.busy && a.uploading === 0 && (a.text.trim().length > 0 || a.fileCount > 0);
}

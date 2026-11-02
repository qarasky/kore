import type { Attachment, ChatMessage, Source, StreamEvent } from "@zero/shared";

export type Draft = { text: string; sources: Source[]; status: "thinking" | "searching" | null };
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
    messages: [...s.messages, { id: localId(), role: "user", text, attachments, sources: [], createdAt: Date.now() }],
    draft: { text: "", sources: [], status: "thinking" },
    error: null,
    connectProvider: false,
  };
}

export function applyEvent(s: ChatState, ev: StreamEvent): ChatState {
  const d = s.draft ?? { text: "", sources: [], status: null };
  switch (ev.type) {
    case "status":
      return { ...s, draft: { ...d, status: ev.state } };
    case "delta":
      return { ...s, draft: { ...d, text: d.text + ev.text, status: null } };
    case "source":
      return { ...s, draft: { ...d, sources: [...d.sources, { title: ev.title, url: ev.url }] } };
    case "done":
      return {
        ...s,
        draft: null,
        messages: [...s.messages, { id: ev.messageId, role: "assistant", text: d.text, attachments: [], sources: d.sources, createdAt: Date.now() }],
      };
    case "title":
      return s; // the chat list shows it; the transcript is unchanged
    case "error": {
      const partial = d.text || d.sources.length
        ? [...s.messages, { id: localId(), role: "assistant" as const, text: d.text, attachments: [], sources: d.sources, createdAt: Date.now() }]
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

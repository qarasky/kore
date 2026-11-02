import type {
  Attachment, AuthRequest, AuthResponse, ChatMessage, ChatSummary, Health, MemoryEntry, PairStart, ProviderConnection, ProviderInfo, SendMessageRequest, Settings, SignInStart, SignInStatus, StreamEvent, User,
} from "@zero/shared";
import { parseStream } from "./stream";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterSec?: number) { super(message); }
}

export function createApi(baseUrl: string, getToken: () => string | null) {
  async function req<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
    } catch {
      throw new ApiError(0, "unreachable", `Can't reach ${baseUrl}. Check the address and that the server is running.`);
    }
    if (!res.ok) {
      const e = ((await res.json().catch(() => null)) as { error?: { code: string; message: string; retryAfterSec?: number } } | null)?.error;
      throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (${res.status})`, e?.retryAfterSec);
    }
    return (await res.json()) as T;
  }

  return {
    baseUrl,
    health: () => req<Health>("GET", "/health"),
    register: (b: AuthRequest) => req<AuthResponse>("POST", "/auth/register", b),
    login: (b: AuthRequest) => req<AuthResponse>("POST", "/auth/login", b),
    logout: () => req<{ ok: true }>("POST", "/auth/logout"),
    me: () => req<User>("GET", "/me"),
    models: () => req<ProviderInfo[]>("GET", "/models"),
    startPair: () => req<PairStart>("POST", "/auth/pair"),
    answerApproval: (chatId: string, id: string, allow: boolean) => req<{ ok: true }>("POST", `/chats/${encodeURIComponent(chatId)}/approvals/${encodeURIComponent(id)}`, { allow }),
    providers: () => req<ProviderConnection[]>("GET", "/providers"),
    startSignIn: (id: string) => req<SignInStart>("POST", `/providers/${encodeURIComponent(id)}/signin`),
    signInStatus: (id: string, attempt: string) => req<SignInStatus>("GET", `/providers/${encodeURIComponent(id)}/signin/${encodeURIComponent(attempt)}`),
    favorites: () => req<string[]>("GET", "/favorites"),
    setFavorites: (keys: string[]) => req<string[]>("PUT", "/favorites", keys),
    setProviderKey: (id: string, key: string) => req<{ ok: true }>("PUT", `/providers/${encodeURIComponent(id)}/key`, { key }),
    removeProviderKey: (id: string) => req<{ ok: true }>("DELETE", `/providers/${encodeURIComponent(id)}/key`),
    chats: () => req<ChatSummary[]>("GET", "/chats"),
    createChat: () => req<ChatSummary>("POST", "/chats"),
    chat: (id: string) => req<{ chat: ChatSummary; messages: ChatMessage[] }>("GET", `/chats/${id}`),
    deleteChat: (id: string) => req<{ ok: true }>("DELETE", `/chats/${id}`),
    abort: (id: string) => req<{ ok: true }>("POST", `/chats/${id}/abort`),
    upload: (file: File) => { const f = new FormData(); f.set("file", file); return req<Attachment>("POST", "/uploads", undefined, f); },
    uploadUrl: (id: string) => `${baseUrl}/uploads/${id}?token=${encodeURIComponent(getToken() ?? "")}`,
    memory: () => req<MemoryEntry[]>("GET", "/memory"),
    updateMemory: (id: string, text: string) => req<{ ok: true }>("PUT", `/memory/${id}`, { text }),
    deleteMemory: (id: string) => req<{ ok: true }>("DELETE", `/memory/${id}`),
    settings: () => req<Settings>("GET", "/settings"),
    putSettings: (s: Settings) => req<Settings>("PUT", "/settings", s),

    /** Sends a message and yields stream events. Network errors become a single error event. */
    async *send(chatId: string, body: SendMessageRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
      const token = getToken();
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chats/${chatId}/messages`, {
          method: "POST", signal,
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (signal?.aborted) { yield { type: "error", code: "aborted", message: "Stopped" }; return; }
        yield { type: "error", code: "engine", message: `Can't reach ${baseUrl}.` };
        return;
      }
      if (!res.ok || !res.body) {
        const e = ((await res.json().catch(() => null)) as { error?: { message: string } } | null)?.error;
        yield { type: "error", code: "engine", message: e?.message ?? `Request failed (${res.status})` };
        return;
      }
      try { yield* parseStream(res.body); }
      catch { yield { type: "error", code: signal?.aborted ? "aborted" : "engine", message: signal?.aborted ? "Stopped" : "The connection dropped." }; }
    },
  };
}
export type Api = ReturnType<typeof createApi>;

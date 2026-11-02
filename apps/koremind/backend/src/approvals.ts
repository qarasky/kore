import type { StreamEvent } from "@zero/shared";

export type Outcome = "allowed" | "denied" | "expired";
export type AskArgs = { userId: string; chatId: string; targetChatId: string; chatTitle: string; action: "read" | "edit" };

/**
 * The assistant may only touch another chat's notes when the user says so. A request becomes a card in the chat
 * (an `approval` event); the tool call waits for the answer. An allowed chat stays allowed until the turn ends.
 */
export function createApprovals(o: { emit(chatId: string, ev: StreamEvent): void; timeoutMs?: number }) {
  const timeoutMs = o.timeoutMs ?? 60_000;
  type Pending = { userId: string; chatId: string; finish(outcome: Outcome): void };
  const pending = new Map<string, Pending>();
  const grants = new Map<string, Set<string>>(); // chatId -> "targetChatId:read" | "targetChatId:edit"

  const granted = (chatId: string, target: string, action: "read" | "edit") => {
    const g = grants.get(chatId);
    return !!g && (g.has(`${target}:edit`) || (action === "read" && g.has(`${target}:read`)));
  };

  return {
    ask(a: AskArgs): Promise<Outcome> {
      if (granted(a.chatId, a.targetChatId, a.action)) return Promise.resolve("allowed");
      const id = crypto.randomUUID();
      return new Promise<Outcome>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = (outcome: Outcome) => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          if (outcome === "allowed") {
            const g = grants.get(a.chatId) ?? new Set();
            g.add(`${a.targetChatId}:${a.action}`);
            grants.set(a.chatId, g);
          }
          o.emit(a.chatId, { type: "approval_closed", id, outcome });
          resolve(outcome);
        };
        pending.set(id, { userId: a.userId, chatId: a.chatId, finish });
        timer = setTimeout(() => finish("expired"), timeoutMs);
        o.emit(a.chatId, { type: "approval", id, action: a.action, chat: a.chatTitle });
      });
    },

    /** False when the request is unknown, already closed, or belongs to someone else. */
    answer(userId: string, chatId: string, id: string, allow: boolean): boolean {
      const p = pending.get(id);
      if (!p || p.userId !== userId || p.chatId !== chatId) return false;
      p.finish(allow ? "allowed" : "denied");
      return true;
    },

    /** The turn is over: forget what was allowed and close anything still waiting. */
    endTurn(chatId: string) {
      grants.delete(chatId);
      for (const p of [...pending.values()]) if (p.chatId === chatId) p.finish("expired");
    },
  };
}
export type Approvals = ReturnType<typeof createApprovals>;

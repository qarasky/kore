// Messages of a chat form a tree: editing a message adds a sibling next to it, and everything after it on the new
// branch hangs below that sibling. The apps show one branch, from the first message down to the chat's leaf.

export type Node = { id: string; parentId: string | null; role: string; text: string; createdAt: number };

/** The branch ending at [leafId], oldest first. Stops at a missing parent or a loop instead of failing. */
export function branchTo<T extends Node>(leafId: string | null, byId: Map<string, T>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  let cur = leafId ? byId.get(leafId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out.reverse();
}

/** Following the newest child at each step from [id]: where a branch the user switches to continues. */
export function newestLeafUnder<T extends Node>(id: string, all: T[]): string {
  const kids = new Map<string, T[]>();
  for (const m of all) if (m.parentId) kids.set(m.parentId, [...(kids.get(m.parentId) ?? []), m]);
  let cur = id;
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cur)) return cur;
    seen.add(cur);
    const next = (kids.get(cur) ?? []).reduce<T | null>((best, m) => (!best || m.createdAt >= best.createdAt ? m : best), null);
    if (!next) return cur;
    cur = next.id;
  }
}

/** Variants of a user message: the user messages with the same parent, oldest first. */
export function variantsOf<T extends Node>(m: T, all: T[]): string[] {
  return all.filter((x) => x.role === "user" && x.parentId === m.parentId).sort((a, b) => a.createdAt - b.createdAt).map((x) => x.id);
}

const MAX_MESSAGE = 4000;
const MAX_TRANSCRIPT = 24_000;

/**
 * The conversation so far, for a fresh engine session (an edit starts one, since the old session already holds the
 * text being replaced). Each message is capped and the oldest are dropped first when it gets long. "" when empty.
 */
export function transcriptOf(messages: Pick<Node, "role" | "text">[]): string {
  const lines = messages
    .filter((m) => m.text.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.length > MAX_MESSAGE ? m.text.slice(0, MAX_MESSAGE) + " […]" : m.text}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length > MAX_TRANSCRIPT && kept.length) break;
    kept.unshift(lines[i]);
    size += lines[i].length;
  }
  if (!kept.length) return "";
  return `The conversation so far in this chat, for context (the user's next message follows it):\n\n${kept.join("\n\n")}`;
}

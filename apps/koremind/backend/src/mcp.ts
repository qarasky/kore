import { z } from "zod";
import type { NoteCtx, ToolResult } from "./notes";

type MemoryTools = {
  remember(ctx: NoteCtx, a: { text: string }): ToolResult | Promise<ToolResult>;
  recall(ctx: NoteCtx, a: { query?: string }): ToolResult | Promise<ToolResult>;
  update(ctx: NoteCtx, a: { id: string; text: string }): ToolResult | Promise<ToolResult>;
  forget(ctx: NoteCtx, a: { id: string }): ToolResult | Promise<ToolResult>;
};

type NoteTools = {
  save(ctx: NoteCtx, a: { title: string; body: string }): Promise<ToolResult>;
  read(ctx: NoteCtx, a: { chat?: string }): Promise<ToolResult>;
  edit(ctx: NoteCtx, a: { id: string; title?: string; body?: string; chat?: string }): Promise<ToolResult>;
};

const SESSION_KEY = "ai.opencode/sessionID";
/** Claude Code can't put the session in `_meta`, so KoreMind gives each `claude -p` run this header with its session id. */
export const MCP_SESSION_HEADER = "x-koremind-session";
const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "save_note",
    description: "Save a note for the user in the current chat. Use it when the user asks you to note or write something down for this chat (a list, a draft, a plan). Notes belong to this chat only; durable facts about the user go to remember instead.",
    inputSchema: { type: "object", properties: { title: { type: "string", description: "Short title, up to 120 characters" }, body: { type: "string", description: "The text of the note" } }, required: ["title", "body"], additionalProperties: false },
  },
  {
    name: "read_notes",
    description: "Read the notes saved in the current chat. To read the notes of another of the user's chats, pass `chat` with that chat's title; the user is asked to approve first, so only do this when they asked you to look at another chat.",
    inputSchema: { type: "object", properties: { chat: { type: "string", description: "Title of another chat. Omit for the current chat." } }, additionalProperties: false },
  },
  {
    name: "edit_note",
    description: "Change the title or text of an existing note by its id (read the notes first to get ids). Defaults to the current chat; pass `chat` to edit a note in another chat, which needs the user's approval.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The note id, like note_1a2b3c4d5e" }, title: { type: "string" }, body: { type: "string", description: "The full new text of the note" }, chat: { type: "string", description: "Title of another chat. Omit for the current chat." } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "remember",
    description: "Save one durable fact or preference about the user to memory, shared across all their chats: who they are, where they live, their work and projects, tastes, habits, how they like answers. Use it when the user tells you something about themself that will still matter in later chats, or asks you to remember something. Never save a one-off request or task, anything about notes, guesses, or things already in memory (recall first if unsure; to change an entry use update_memory). One short self-contained sentence per call, in the user's language.",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The fact, up to 300 characters, e.g. \"Prefers short answers with code first\"" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "recall_memory",
    description: "Look things up in what you remember about the user. Pass a query (a few keywords, e.g. \"car\", \"diet allergies\", \"work stack\") for matching entries, or no query to list every memory. Use it whenever a detail about the user would help and is not already in your context; never guess instead. Entries come with ids for update_memory and forget_memory.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Keywords to search for. Omit to list all memories." } }, additionalProperties: false },
  },
  {
    name: "update_memory",
    description: "Replace the text of a memory entry by its id (recall first to get ids). Use it when a remembered fact has changed or was wrong.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, text: { type: "string", description: "The full new text of the entry" } }, required: ["id", "text"], additionalProperties: false },
  },
  {
    name: "forget_memory",
    description: "Delete a memory entry by its id (recall first to get ids). Use it when the user asks you to forget something or a fact no longer holds.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
];

const Args = {
  save_note: z.object({ title: z.string(), body: z.string() }),
  read_notes: z.object({ chat: z.string().optional() }),
  edit_note: z.object({ id: z.string(), title: z.string().optional(), body: z.string().optional(), chat: z.string().optional() }),
  remember: z.object({ text: z.string() }),
  recall_memory: z.object({ query: z.string().optional() }),
  update_memory: z.object({ id: z.string(), text: z.string() }),
  forget_memory: z.object({ id: z.string() }),
};

const Req = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });

/**
 * A minimal MCP server (Streamable HTTP, JSON responses) that gives OpenCode the notes and memory tools. OpenCode sends the
 * session id with every call; it is mapped back to the user's chat here, so the model can never name a user or chat itself.
 */
export function createMcp(o: { resolveSession(sessionId: string): NoteCtx | null; notes: NoteTools; memory?: MemoryTools }) {
  const run: Record<keyof typeof Args, (ctx: NoteCtx, a: any) => ToolResult | Promise<ToolResult>> = {
    save_note: (c, a) => o.notes.save(c, a),
    read_notes: (c, a) => o.notes.read(c, a),
    edit_note: (c, a) => o.notes.edit(c, a),
    remember: (c, a) => o.memory ? o.memory.remember(c, a) : { text: "Memory is not available.", isError: true },
    recall_memory: (c, a) => o.memory ? o.memory.recall(c, a) : { text: "Memory is not available.", isError: true },
    update_memory: (c, a) => o.memory ? o.memory.update(c, a) : { text: "Memory is not available.", isError: true },
    forget_memory: (c, a) => o.memory ? o.memory.forget(c, a) : { text: "Memory is not available.", isError: true },
  };
  const ok = (id: unknown, result: unknown) => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
  const bad = (id: unknown, code: number, message: string) => ({ status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
  const toolError = (id: unknown, text: string) => ok(id, { content: [{ type: "text", text }], isError: true });

  return {
    /** `headerSession` is the x-koremind-session header (Claude); OpenCode's `_meta` session wins when both are there. */
    async handle(raw: unknown, headerSession?: string): Promise<{ status: number; body?: unknown }> {
      const parsed = Req.safeParse(raw);
      if (!parsed.success) return bad(null, -32600, "Invalid request");
      const { id, method, params } = parsed.data;
      if (id === undefined) return { status: 202 }; // notifications
      if (method === "initialize") return ok(id, { protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "koremind", version: "1" } });
      if (method === "ping") return ok(id, {});
      if (method === "tools/list") return ok(id, { tools: TOOLS });
      if (method !== "tools/call") return bad(id, -32601, `Method not found: ${method}`);

      const name = String(params?.name ?? "");
      if (!(name in Args)) return bad(id, -32602, `Unknown tool: ${name}`);
      const metaSession = (params?._meta as Record<string, unknown> | undefined)?.[SESSION_KEY];
      const sessionId = typeof metaSession === "string" ? metaSession : headerSession;
      const ctx = sessionId ? o.resolveSession(sessionId) : null;
      if (!ctx) return toolError(id, "These tools are only available inside a chat.");
      const args = Args[name as keyof typeof Args].safeParse(params?.arguments ?? {});
      if (!args.success) return toolError(id, `Invalid arguments: ${args.error.issues[0]?.message ?? "check the tool's input"}`);
      try {
        const r = await run[name as keyof typeof Args](ctx, args.data);
        return ok(id, { content: [{ type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) });
      } catch (e) {
        return toolError(id, e instanceof Error ? e.message : "The tool failed.");
      }
    },
  };
}
export type Mcp = ReturnType<typeof createMcp>;

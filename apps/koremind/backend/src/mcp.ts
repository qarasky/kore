import { z } from "zod";
import type { NoteCtx, ToolResult } from "./notes";

type NoteTools = {
  save(ctx: NoteCtx, a: { title: string; body: string }): Promise<ToolResult>;
  read(ctx: NoteCtx, a: { chat?: string }): Promise<ToolResult>;
  edit(ctx: NoteCtx, a: { id: string; title?: string; body?: string; chat?: string }): Promise<ToolResult>;
};

const SESSION_KEY = "ai.opencode/sessionID";
const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "save_note",
    description: "Save a note for the user in the current chat. Use it when the user asks you to note, remember-for-this-chat or write something down. Notes belong to this chat only.",
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
];

const Args = {
  save_note: z.object({ title: z.string(), body: z.string() }),
  read_notes: z.object({ chat: z.string().optional() }),
  edit_note: z.object({ id: z.string(), title: z.string().optional(), body: z.string().optional(), chat: z.string().optional() }),
};

const Req = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.record(z.string(), z.unknown()).optional() });

/**
 * A minimal MCP server (Streamable HTTP, JSON responses) that gives OpenCode the notes tools. OpenCode sends the
 * session id with every call; it is mapped back to the user's chat here, so the model can never name a user or chat itself.
 */
export function createMcp(o: { resolveSession(sessionId: string): NoteCtx | null; notes: NoteTools }) {
  const ok = (id: unknown, result: unknown) => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
  const bad = (id: unknown, code: number, message: string) => ({ status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
  const toolError = (id: unknown, text: string) => ok(id, { content: [{ type: "text", text }], isError: true });

  return {
    async handle(raw: unknown): Promise<{ status: number; body?: unknown }> {
      const parsed = Req.safeParse(raw);
      if (!parsed.success) return bad(null, -32600, "Invalid request");
      const { id, method, params } = parsed.data;
      if (id === undefined) return { status: 202 }; // notifications
      if (method === "initialize") return ok(id, { protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "zero", version: "1" } });
      if (method === "ping") return ok(id, {});
      if (method === "tools/list") return ok(id, { tools: TOOLS });
      if (method !== "tools/call") return bad(id, -32601, `Method not found: ${method}`);

      const name = String(params?.name ?? "");
      if (!(name in Args)) return bad(id, -32602, `Unknown tool: ${name}`);
      const sessionId = (params?._meta as Record<string, unknown> | undefined)?.[SESSION_KEY];
      const ctx = typeof sessionId === "string" ? o.resolveSession(sessionId) : null;
      if (!ctx) return toolError(id, "Notes are only available inside a chat.");
      const args = Args[name as keyof typeof Args].safeParse(params?.arguments ?? {});
      if (!args.success) return toolError(id, `Invalid arguments: ${args.error.issues[0]?.message ?? "check the tool's input"}`);
      try {
        const r = await (o.notes[name === "save_note" ? "save" : name === "read_notes" ? "read" : "edit"] as (c: NoteCtx, a: unknown) => Promise<ToolResult>)(ctx, args.data);
        return ok(id, { content: [{ type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) });
      } catch (e) {
        return toolError(id, e instanceof Error ? e.message : "The notes tool failed.");
      }
    },
  };
}
export type Mcp = ReturnType<typeof createMcp>;

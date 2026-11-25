import type { ModelInfo } from "@koremind/shared";
import { AGENT_SYSTEM } from "./opencode";
import type { EngineEvent, EngineFile, ModelRef } from "./types";

// Claude through the server's own, unmodified Claude Code CLI (`claude -p`), signed in by its owner on the server.
// See docs/claude-integration.md (route C) and docs/superpowers/specs/2026-11-26-claude-engine-host-cli-design.md.

const LEVELS = ["low", "medium", "high", "xhigh", "max"];
const model = (id: string, name: string, isDefault = false): ModelInfo => ({ id, name, vision: true, thinkingLevels: LEVELS, isDefault, free: false });

export const CLAUDE_DEFAULT = "claude-sonnet-5-5";
export const CLAUDE_MODELS: ModelInfo[] = [
  model("claude-fable-5-2", "Fable 5.2"),
  model("claude-opus-5-5", "Opus 5.5"),
  model(CLAUDE_DEFAULT, "Sonnet 5.5", true),
  model("claude-haiku-5-5", "Haiku 5.5"),
];
/** Chat titles are short and frequent: always the small model. */
export const CLAUDE_TITLE_MODEL: ModelRef = { providerId: "claude", modelId: "claude-haiku-5-5" };

/** The same assistant as on OpenCode. Claude tends to append its own source list, which the apps already show. */
export const CLAUDE_SYSTEM = `${AGENT_SYSTEM} The apps list the pages you searched under your answer, so do not add your own list of sources or links to them.`;

export type ClaudeArgs = {
  model: string;
  effort?: string;
  sessionId: string;
  /** Continue an existing conversation (`--resume`) instead of opening one (`--session-id`). */
  resume: boolean;
  system: string;
  mcpConfig?: string;
  /** "chat": web search plus KoreMind's own tools. "none": no tools at all (titles, memory summaries). */
  tools: "chat" | "none";
  /** false: a one-off run that leaves no conversation on disk. */
  persist: boolean;
};

/**
 * The flags that make Claude Code a chat assistant and not a coding agent: none of the server's settings, hooks, plugins, MCP
 * servers or CLAUDE.md; no shell or file tools; nothing that would wait for a permission prompt. Never `--bare`: it refuses
 * subscription logins.
 */
export function claudeArgs(o: ClaudeArgs): string[] {
  const a = [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--input-format", "stream-json",
    "--setting-sources", "", "--strict-mcp-config", "--permission-prompts", "none",
    "--system-prompt", o.system, "--model", o.model,
  ];
  if (o.effort) a.push("--effort", o.effort);
  if (o.tools === "chat") {
    a.push("--tools", "WebSearch", "--allowedTools", "WebSearch mcp__koremind__*");
    if (o.mcpConfig) a.push("--mcp-config", o.mcpConfig);
  } else {
    a.push("--tools", "");
  }
  if (o.persist) a.push(o.resume ? "--resume" : "--session-id", o.sessionId);
  else a.push("--no-session-persistence");
  return a;
}

/** KoreMind's notes and memory tools, reached over loopback with the per-run secret; the header names the chat. */
export const mcpConfigJson = (url: string, secret: string, sessionId: string): string =>
  JSON.stringify({ mcpServers: { koremind: { type: "http", url, headers: { authorization: `Bearer ${secret}`, "x-koremind-session": sessionId } } } });

const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/** One stream-json input line: attachments first, then the prompt. */
export function userMessage(text: string, files: EngineFile[]): string {
  const content: unknown[] = [];
  for (const f of files) {
    const data = base64Of(f.dataUrl);
    if (f.mime.startsWith("image/")) content.push({ type: "image", source: { type: "base64", media_type: f.mime, data } });
    else if (f.mime === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    else content.push({ type: "text", text: `${f.name}\n\n${Buffer.from(data, "base64").toString("utf8")}` });
  }
  content.push({ type: "text", text });
  return JSON.stringify({ type: "user", message: { role: "user", content } });
}

/** Pages named by a WebSearch result: its text carries `Links: [{"title","url"}, …]`. */
export function linksFrom(content: unknown): { title: string; url: string }[] {
  const text = typeof content === "string" ? content
    : Array.isArray(content) ? content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("\n") : "";
  const at = text.indexOf("Links: [");
  if (at < 0) return [];
  // The array ends at the first "]" that closes it; titles may contain brackets, so try each candidate end.
  const start = at + "Links: ".length;
  let list: unknown = null;
  for (let end = text.indexOf("]", start); end >= 0 && list === null; end = text.indexOf("]", end + 1)) {
    try { list = JSON.parse(text.slice(start, end + 1)); } catch { /* keep looking */ }
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(), out: { title: string; url: string }[] = [];
  for (const l of list as any[]) {
    const url = typeof l?.url === "string" ? l.url : "";
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: typeof l.title === "string" && l.title.trim() ? l.title.trim() : url, url });
    if (out.length === 8) break;
  }
  return out;
}

const NEEDS_OWNER = /log ?in|logged|auth|api key|credential|usage limit|rate limit/i;

/** Maps Claude Code's stream-json output lines to engine events. Stateful: it remembers which tool calls were web searches. */
export function createClaudeMapper(): (line: unknown) => EngineEvent[] {
  const searches = new Set<string>();
  return (line) => {
    const e = line as any;
    switch (e?.type) {
      case "stream_event": {
        const ev = e.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") return ev.delta.text ? [{ type: "delta", text: String(ev.delta.text) }] : [];
        if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use" && ev.content_block.name === "WebSearch") {
          searches.add(String(ev.content_block.id));
          return [{ type: "status", state: "searching" }];
        }
        return [];
      }
      case "user": {
        const out: EngineEvent[] = [];
        for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
          if (b?.type !== "tool_result" || !searches.has(String(b.tool_use_id))) continue;
          for (const l of linksFrom(b.content)) out.push({ type: "source", title: l.title, url: l.url });
        }
        return out;
      }
      case "rate_limit_event": {
        // Only a refusal ends the reply; other states (seen: "allowed") are informational. A refused request also ends in an error result.
        return e.rate_limit_info?.status === "rejected" ? [{ type: "error", message: "Claude's usage limit is reached. Try again later.", noProvider: true }] : [];
      }
      case "result": {
        if (e.subtype === "success" && !e.is_error) return [{ type: "done" }];
        const message = String((Array.isArray(e.errors) && e.errors.length ? e.errors.join("; ") : e.result) || "Claude could not answer.").slice(0, 300);
        return [NEEDS_OWNER.test(message) ? { type: "error", message, noProvider: true } : { type: "error", message }];
      }
      default:
        return [];
    }
  };
}

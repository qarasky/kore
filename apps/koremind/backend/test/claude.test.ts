import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_DEFAULT, CLAUDE_MODELS, CLAUDE_SYSTEM, CLAUDE_TITLE_MODEL, claudeArgs, createClaudeMapper, linksFrom, mcpConfigJson, userMessage } from "../src/engine/claude";
import { AGENT_SYSTEM } from "../src/engine/opencode";
import type { EngineEvent } from "../src/engine/types";

const fixture = readFileSync(join(import.meta.dir, "fixtures/claude-websearch.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const run = (lines: unknown[]) => { const map = createClaudeMapper(); return lines.flatMap((l) => map(l)); };

test("the catalogue: four models, Sonnet is the default, titles on Haiku", () => {
  expect(CLAUDE_MODELS.map((m) => [m.id, m.name])).toEqual([["claude-fable-5-2", "Fable 5.2"], ["claude-opus-5-5", "Opus 5.5"], ["claude-sonnet-5-5", "Sonnet 5.5"], ["claude-haiku-5-5", "Haiku 5.5"]]);
  expect(CLAUDE_MODELS.filter((m) => m.isDefault).map((m) => m.id)).toEqual([CLAUDE_DEFAULT]);
  expect(CLAUDE_DEFAULT).toBe("claude-sonnet-5-5");
  expect(CLAUDE_MODELS.every((m) => m.vision && !m.free)).toBe(true);
  expect(CLAUDE_TITLE_MODEL).toEqual({ providerId: "claude", modelId: "claude-haiku-5-5" });
  expect(CLAUDE_SYSTEM.startsWith(AGENT_SYSTEM)).toBe(true);
  expect(CLAUDE_SYSTEM).toContain("do not add your own list of sources");
});

test("the fixture maps to searching, two sources, the text and done", () => {
  expect(run(fixture)).toEqual<EngineEvent[]>([
    { type: "status", state: "searching" },
    { type: "source", title: "Bun blog", url: "https://bun.com/blog" },
    { type: "source", title: "npm", url: "https://www.npmjs.com/package/bun" },
    { type: "delta", text: "The latest " },
    { type: "delta", text: "is **1.4.5**." },
    { type: "done" },
  ]);
});

test("a usage limit ends the reply as noProvider", () => {
  expect(run([{ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour" } }])).toEqual([{ type: "error", message: "Claude's usage limit is reached. Try again later.", noProvider: true }]);
});

test("an error result is an error event", () => {
  expect(run([{ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Something broke"] }])).toEqual([{ type: "error", message: "Something broke" }]);
  expect(run([{ type: "result", subtype: "success", is_error: true, result: "API Error: 500" }])).toEqual([{ type: "error", message: "API Error: 500" }]);
});

test("a not-logged-in result is noProvider", () => {
  expect(run([{ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login" }])).toEqual([{ type: "error", message: "Not logged in · Please run /login", noProvider: true }]);
});

test("tool results of other tools are not sources", () => {
  const lines = [
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t2", name: "mcp__koremind__read_notes", input: {} } } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: 'Links: [{"title":"x","url":"https://x.test"}]' }] } },
  ];
  expect(run(lines)).toEqual([]);
});

test("chat args are locked down", () => {
  const a = claudeArgs({ model: "claude-sonnet-5-5", sessionId: "s-1", resume: false, system: "SYS", mcpConfig: "{}", tools: "chat", persist: true });
  const pair = (flag: string) => a[a.indexOf(flag) + 1];
  expect(a[0]).toBe("-p");
  for (const f of ["--strict-mcp-config", "--verbose", "--include-partial-messages"]) expect(a).toContain(f);
  expect(pair("--output-format")).toBe("stream-json");
  expect(pair("--input-format")).toBe("stream-json");
  expect(pair("--setting-sources")).toBe("");
  expect(pair("--tools")).toBe("WebSearch");
  expect(pair("--allowedTools")).toBe("WebSearch mcp__koremind__*");
  expect(pair("--permission-prompts")).toBe("none");
  expect(pair("--system-prompt")).toBe("SYS");
  expect(pair("--model")).toBe("claude-sonnet-5-5");
  expect(pair("--mcp-config")).toBe("{}");
  expect(pair("--session-id")).toBe("s-1");
  expect(a).not.toContain("--resume");
  expect(a).not.toContain("--effort");
  expect(a).not.toContain("--bare");
  expect(a.join(" ")).not.toMatch(/\bBash\b|\bdefault\b/);
  const r = claudeArgs({ model: "m", effort: "high", sessionId: "s-1", resume: true, system: "", mcpConfig: "{}", tools: "chat", persist: true });
  expect(r[r.indexOf("--resume") + 1]).toBe("s-1");
  expect(r).not.toContain("--session-id");
  expect(r[r.indexOf("--effort") + 1]).toBe("high");
});

test("complete args have no tools and no session", () => {
  const a = claudeArgs({ model: "claude-haiku-5-5", sessionId: "ignored", resume: false, system: "Title it", tools: "none", persist: false, mcpConfig: "{}" });
  expect(a[a.indexOf("--tools") + 1]).toBe("");
  expect(a).toContain("--no-session-persistence");
  expect(a).toContain("--strict-mcp-config");
  for (const f of ["--mcp-config", "--session-id", "--resume", "--allowedTools"]) expect(a).not.toContain(f);
});

test("the MCP config points at KoreMind with the secret and the session", () => {
  expect(JSON.parse(mcpConfigJson("http://127.0.0.1:8787/mcp", "sek", "s-1"))).toEqual({ mcpServers: { koremind: { type: "http", url: "http://127.0.0.1:8787/mcp", headers: { authorization: "Bearer sek", "x-koremind-session": "s-1" } } } });
});

test("userMessage puts files before the text", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const msg = JSON.parse(userMessage("What is this?", [
    { name: "a.png", mime: "image/png", dataUrl: `data:image/png;base64,${b64("PNG")}` },
    { name: "b.pdf", mime: "application/pdf", dataUrl: `data:application/pdf;base64,${b64("PDF")}` },
    { name: "c.txt", mime: "text/plain", dataUrl: `data:text/plain;base64,${b64("hello")}` },
  ]));
  expect(msg.type).toBe("user");
  expect(msg.message.role).toBe("user");
  expect(msg.message.content).toEqual([
    { type: "image", source: { type: "base64", media_type: "image/png", data: b64("PNG") } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64("PDF") } },
    { type: "text", text: "c.txt\n\nhello" },
    { type: "text", text: "What is this?" },
  ]);
  expect(userMessage("one line", []).includes("\n")).toBe(false);
});

test("linksFrom reads the Links array, dedupes, caps at 8 and survives junk", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, url: `https://x.test/${i}` }));
  expect(linksFrom(`Links: ${JSON.stringify(many)}\n\nmore`)).toHaveLength(8);
  expect(linksFrom([{ type: "text", text: 'Links: [{"title":"A","url":"https://a.test"}]' }])).toEqual([{ title: "A", url: "https://a.test" }]);
  expect(linksFrom('Links: [{"url":"https://b.test"}]')).toEqual([{ title: "https://b.test", url: "https://b.test" }]);
  expect(linksFrom("no links")).toEqual([]);
  expect(linksFrom("Links: [broken")).toEqual([]);
  expect(linksFrom(42)).toEqual([]);
});

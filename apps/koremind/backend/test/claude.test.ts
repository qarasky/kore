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

// ---- The process side, against a stand-in CLI ----
import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createClaudeEngine } from "../src/engine/claude";

const FAKE = join(import.meta.dir, "fixtures/fake-claude.ts");
const engineFor = (env: Record<string, string> = {}, o: { bin?: string; configDir?: string; idleMs?: number } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "koremind-claude-"));
  const logFile = join(dir, "calls.jsonl");
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries({ FAKE_CLAUDE_LOG: logFile, ...env })) { saved[k] = process.env[k]; process.env[k] = v; }
  const engine = createClaudeEngine({ bin: o.bin ?? FAKE, configDir: o.configDir, dataDir: dir, mcpUrl: "http://127.0.0.1:1/mcp", mcpSecret: "sek", idleMs: o.idleMs });
  const calls = () => existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const restore = () => { for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v); };
  return { engine, calls, dir, restore };
};
const send = (engine: ReturnType<typeof createClaudeEngine>, sessionId: string, o: { text?: string; system?: string; signal?: AbortSignal } = {}) =>
  engine.prompt({ sessionId, system: o.system ?? "", text: o.text ?? "hi", files: [], model: { providerId: "claude", modelId: "claude-haiku-5-5" }, signal: o.signal ?? new AbortController().signal });
const all = async (it: AsyncIterable<EngineEvent>) => { const out: EngineEvent[] = []; for await (const e of it) out.push(e); return out; };

test("a reply streams and the first prompt opens the session with the context block", async () => {
  const t = engineFor();
  try {
    const sid = await t.engine.createSession({ providerId: "claude", modelId: "claude-haiku-5-5" });
    const evs = await all(send(t.engine, sid, { text: "latest bun?", system: "The user's name is Sky." }));
    expect(evs[0]).toEqual({ type: "status", state: "thinking" });
    expect(evs.at(-1)).toEqual({ type: "done" });
    expect(evs.filter((e) => e.type === "source")).toHaveLength(2);
    const [c] = t.calls();
    expect(c.args[c.args.indexOf("--session-id") + 1]).toBe(sid);
    expect(c.args[c.args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    const msg = JSON.parse(c.stdin.trim());
    expect(msg.message.content.at(-1).text).toStartWith("<context>\nThe user's name is Sky.\n</context>\n\nlatest bun?");
    const mcp = JSON.parse(c.args[c.args.indexOf("--mcp-config") + 1]);
    expect(mcp.mcpServers.koremind.headers["x-koremind-session"]).toBe(sid);
    expect(c.cwd).toBe(join(t.dir, "claude-work"));
    expect(c.env.CLAUDE_CODE_ENTRYPOINT).toBe("koremind");
    expect(c.env.MCP_TOOL_TIMEOUT).toBe("120000");
  } finally { t.restore(); }
});

test("the second prompt resumes and sends no context", async () => {
  const t = engineFor();
  try {
    const sid = await t.engine.createSession();
    await all(send(t.engine, sid, { system: "ctx" }));
    await all(send(t.engine, sid, { text: "again", system: "ctx" }));
    const c = t.calls()[1];
    expect(c.args[c.args.indexOf("--resume") + 1]).toBe(sid);
    expect(c.args).not.toContain("--session-id");
    expect(JSON.parse(c.stdin.trim()).message.content.at(-1).text).toBe("again");
  } finally { t.restore(); }
});

test("a session this process never opened (after a restart) is resumed", async () => {
  const t = engineFor();
  try {
    await all(send(t.engine, "22222222-2222-4222-8222-222222222222"));
    const c = t.calls()[0];
    expect(c.args[c.args.indexOf("--resume") + 1]).toBe("22222222-2222-4222-8222-222222222222");
  } finally { t.restore(); }
});

test("thinking levels go to --effort", async () => {
  const t = engineFor();
  try {
    const sid = await t.engine.createSession();
    await all(t.engine.prompt({ sessionId: sid, system: "", text: "hi", files: [], model: { providerId: "claude", modelId: "claude-sonnet-5-5" }, thinking: "high", signal: new AbortController().signal }));
    const c = t.calls()[0];
    expect(c.args[c.args.indexOf("--effort") + 1]).toBe("high");
  } finally { t.restore(); }
});

test("stop kills the process", async () => {
  const t = engineFor({ FAKE_CLAUDE_MODE: "hang" });
  try {
    const sid = await t.engine.createSession();
    const ac = new AbortController();
    const started = Date.now();
    const evs: EngineEvent[] = [];
    let pid = 0;
    for await (const e of send(t.engine, sid, { signal: ac.signal })) {
      evs.push(e);
      for (let i = 0; i < 50 && !pid; i++) { pid = t.calls()[0]?.pid ?? 0; if (!pid) await Bun.sleep(100); }
      ac.abort();
    }
    expect(Date.now() - started).toBeLessThan(8000);
    expect(pid).toBeGreaterThan(0);
    await Bun.sleep(300);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(evs.some((e) => e.type === "done")).toBe(false);
  } finally { t.restore(); }
});

test("a reply that goes quiet is stopped by the idle watchdog", async () => {
  const t = engineFor({ FAKE_CLAUDE_MODE: "hang" }, { idleMs: 400 });
  try {
    const evs = await all(send(t.engine, await t.engine.createSession()));
    expect(evs.at(-1)).toEqual({ type: "error", message: "The assistant stopped responding. Try again." });
  } finally { t.restore(); }
});

test("a crash becomes an error with stderr", async () => {
  const t = engineFor({ FAKE_CLAUDE_MODE: "crash" });
  try {
    const evs = await all(send(t.engine, await t.engine.createSession()));
    const err = evs.at(-1) as { type: string; message: string };
    expect(err.type).toBe("error");
    expect(err.message).toContain("boom: something failed");
  } finally { t.restore(); }
});

test("a missing binary is a clear error and not connected", async () => {
  const t = engineFor({}, { bin: "/nonexistent/claude" });
  try {
    expect(await all(send(t.engine, await t.engine.createSession()))).toEqual([{ type: "status", state: "thinking" }, { type: "error", message: "Claude isn't installed on the server.", noProvider: true }]);
    const [p] = await t.engine.listProviders();
    expect(p).toMatchObject({ id: "claude", name: "Claude", status: "needs_connection", connected: false, models: [] });
    await expect(t.engine.complete({ system: "", text: "x" })).rejects.toThrow("Claude isn't installed on the server.");
  } finally { t.restore(); }
});

test("signed in: Claude is ready with its models; logged out shows the hint", async () => {
  const t = engineFor();
  try {
    const [p] = await t.engine.listProviders();
    expect(p).toMatchObject({ id: "claude", status: "ready", connected: true });
    expect(p.models.map((m) => m.id)).toEqual(CLAUDE_MODELS.map((m) => m.id));
    expect(await t.engine.listConnections()).toEqual([{ id: "claude", name: "Claude", connected: true, supportsFreeFilter: false, hint: "" }]);
  } finally { t.restore(); }
  const out = engineFor({ FAKE_CLAUDE_LOGGED_OUT: "1" });
  try {
    const [c] = await out.engine.listConnections();
    expect(c.connected).toBe(false);
    expect(c.hint).toBe("Run `claude auth login` on the server, as the user KoreMind runs as.");
    expect(JSON.stringify(await out.engine.listProviders())).not.toContain("someone@example.test");
  } finally { out.restore(); }
});

test("complete runs without tools and returns the text", async () => {
  const t = engineFor();
  try {
    expect(await t.engine.complete({ kind: "title", system: "Name it", text: "User: hi", model: CLAUDE_TITLE_MODEL })).toBe("The latest is **1.4.5**.");
    const c = t.calls()[0];
    expect(c.args[c.args.indexOf("--tools") + 1]).toBe("");
    expect(c.args).toContain("--no-session-persistence");
    expect(c.args).not.toContain("--mcp-config");
    expect(c.args[c.args.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
    expect(c.args[c.args.indexOf("--system-prompt") + 1]).toBe("Name it");
  } finally { t.restore(); }
});

test("the parent's Claude Code env does not leak; a config dir is passed on", async () => {
  const t = engineFor({ CLAUDECODE: "1" }, { configDir: "/srv/claude-cfg" });
  try {
    await all(send(t.engine, await t.engine.createSession()));
    const c = t.calls()[0];
    expect(c.env.CLAUDECODE).toBeNull();
    expect(c.env.CLAUDE_CONFIG_DIR).toBe("/srv/claude-cfg");
  } finally { t.restore(); }
});

test("deleting a session removes its transcript", async () => {
  const projects = mkdtempSync(join(tmpdir(), "koremind-projects-"));
  const t = engineFor({ FAKE_CLAUDE_PROJECTS: projects });
  try {
    const sid = await t.engine.createSession();
    mkdirSync(join(projects, "-some-cwd"), { recursive: true });
    writeFileSync(join(projects, "-some-cwd", `${sid}.jsonl`), "{}\n");
    writeFileSync(join(projects, "-some-cwd", "other.jsonl"), "{}\n");
    await t.engine.listConnections(); // learns where transcripts live
    await t.engine.deleteSession(sid);
    expect(existsSync(join(projects, "-some-cwd", `${sid}.jsonl`))).toBe(false);
    expect(existsSync(join(projects, "-some-cwd", "other.jsonl"))).toBe(true);
    await t.engine.deleteSession("../../etc/passwd"); // never leaves the projects folder
  } finally { t.restore(); }
});

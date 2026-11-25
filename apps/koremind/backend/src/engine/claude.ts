import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ModelInfo, ProviderConnection, ProviderInfo } from "@koremind/shared";
import { AGENT_SYSTEM, separateAfterTools } from "./opencode";
import { CLOSED, IDLE, Pump } from "./pump";
import type { Engine, EngineEvent, EngineFile, ModelRef, PromptArgs } from "./types";

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

const NOT_INSTALLED = "Claude isn't installed on the server.";
const HINT = "Run `claude auth login` on the server, as the user KoreMind runs as.";
const STATUS_TTL_MS = 30_000;

/** The child's environment: never a parent Claude Code session's variables (KoreMind may itself be started from one). */
function childEnv(configDir?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "CLAUDECODE" && !k.startsWith("CLAUDE_CODE_")) env[k] = v;
  env.CLAUDE_CODE_ENTRYPOINT = "koremind";
  env.MCP_TOOL_TIMEOUT = "120000"; // an approval card waits up to 60 s inside a notes tool call
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

type Run = { events: AsyncIterable<EngineEvent>; kill(): void };

export function createClaudeEngine(o: { bin: string; configDir?: string; dataDir: string; mcpUrl?: string; mcpSecret?: string; idleMs?: number }): Engine {
  const cwd = join(o.dataDir, "claude-work");
  mkdirSync(cwd, { recursive: true });
  const idleMs = o.idleMs ?? 120_000;
  /** Sessions created here that Claude hasn't opened yet: their first prompt uses --session-id and carries the context block. */
  const fresh = new Set<string>();
  let status: { at: number; loggedIn: boolean; projects: string } | null = null;

  async function authStatus() {
    if (status && Date.now() - status.at < STATUS_TTL_MS) return status;
    let loggedIn = false, projects = "";
    try {
      const p = Bun.spawn([o.bin, "auth", "status", "--json"], { cwd, env: childEnv(o.configDir), stdout: "pipe", stderr: "ignore", stdin: "ignore" });
      const out = await new Response(p.stdout).text();
      await p.exited;
      // Only these two fields are read; the rest (account details) is left alone.
      const j = JSON.parse(out);
      loggedIn = j?.loggedIn === true;
      projects = typeof j?.projectsDirectory === "string" ? j.projectsDirectory : "";
    } catch { /* not installed, or not JSON: not signed in */ }
    status = { at: Date.now(), loggedIn, projects };
    return status;
  }

  /** Starts one `claude -p` run and maps its output. Never throws: a failed start is an error event. */
  function start(args: string[], input: string, onInit?: () => void): Run {
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    try {
      proc = Bun.spawn([o.bin, ...args], { cwd, env: childEnv(o.configDir), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    } catch {
      return { events: (async function* () { yield { type: "error", message: NOT_INSTALLED, noProvider: true } as EngineEvent; })(), kill() {} };
    }
    const p = proc;
    const stdin = p.stdin as import("bun").FileSink;
    stdin.write(input + "\n");
    stdin.end();
    let stderr = "";
    (async () => { for await (const c of p.stderr as ReadableStream<Uint8Array>) stderr = (stderr + new TextDecoder().decode(c)).slice(-4000); })().catch(() => {});
    const pump = new Pump<EngineEvent | { type: "exit" }>(idleMs);
    const map = createClaudeMapper();
    (async () => {
      const dec = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
          pump.touch();
          buf += dec.decode(chunk, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            let j: unknown; try { j = JSON.parse(line); } catch { continue; }
            if ((j as any)?.type === "system" && (j as any)?.subtype === "init") onInit?.();
            for (const ev of map(j)) pump.push(ev);
          }
        }
      } catch { /* the stream ends when the process is killed */ }
      await p.exited;
      pump.push({ type: "exit" });
    })();
    async function* events(): AsyncIterable<EngineEvent> {
      for (;;) {
        const v = await pump.next();
        if (v === CLOSED) return;
        if (v === IDLE) { p.kill("SIGTERM"); yield { type: "error", message: "The assistant stopped responding. Try again." }; return; }
        if (v.type === "exit") {
          const last = stderr.trim().split("\n").filter(Boolean).at(-1) ?? "";
          const message = (last || `Claude stopped (exit code ${p.exitCode ?? "?"}).`).slice(0, 300);
          yield /log ?in|logged|auth/i.test(message) ? { type: "error", message, noProvider: true } : { type: "error", message };
          return;
        }
        yield v;
        if (v.type === "done" || v.type === "error") { p.kill("SIGTERM"); return; }
      }
    }
    return { events: events(), kill: () => { pump.close(); p.kill("SIGTERM"); } };
  }

  async function* prompt(a: PromptArgs): AsyncIterable<EngineEvent> {
    if (a.signal.aborted) return;
    const first = fresh.has(a.sessionId);
    const text = first && a.system ? `<context>\n${a.system}\n</context>\n\n${a.text}` : a.text;
    const args = claudeArgs({
      model: a.model.modelId, effort: a.thinking, sessionId: a.sessionId, resume: !first, system: CLAUDE_SYSTEM, tools: "chat", persist: true,
      mcpConfig: o.mcpUrl && o.mcpSecret ? mcpConfigJson(o.mcpUrl, o.mcpSecret, a.sessionId) : undefined,
    });
    // Once Claude has started the run the conversation exists on disk, so later prompts resume it.
    const run = start(args, userMessage(text, a.files), () => fresh.delete(a.sessionId));
    const onAbort = () => run.kill();
    a.signal.addEventListener("abort", onAbort);
    const join_ = separateAfterTools();
    try {
      yield { type: "status", state: "thinking" };
      for await (const ev of run.events) {
        if (a.signal.aborted) return;
        yield join_(ev);
      }
    } finally {
      a.signal.removeEventListener("abort", onAbort);
      run.kill();
    }
  }

  const provider = (loggedIn: boolean): ProviderInfo => ({ id: "claude", name: "Claude", recommended: false, connected: loggedIn, status: loggedIn ? "ready" : "needs_connection", models: loggedIn ? CLAUDE_MODELS : [] });

  return {
    async listProviders() { return [provider((await authStatus()).loggedIn)]; },
    async listConnections(): Promise<ProviderConnection[]> {
      const { loggedIn } = await authStatus();
      return [{ id: "claude", name: "Claude", connected: loggedIn, supportsFreeFilter: false, hint: loggedIn ? "" : HINT }];
    },
    async createSession() { const id = crypto.randomUUID(); fresh.add(id); return id; },
    async deleteSession(id) {
      fresh.delete(id);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return; // only our own uuids; never a path
      const projects = (await authStatus()).projects;
      if (!projects) return;
      try {
        for (const d of readdirSync(projects, { withFileTypes: true })) if (d.isDirectory()) rmSync(join(projects, d.name, `${id}.jsonl`), { force: true });
      } catch { /* nothing to clean */ }
    },
    prompt,
    async complete({ system, text, model, thinking }) {
      const args = claudeArgs({ model: model?.modelId ?? CLAUDE_DEFAULT, effort: thinking, sessionId: "", resume: false, system, tools: "none", persist: false });
      const run = start(args, userMessage(text, []));
      let out = "";
      try {
        for await (const e of run.events) {
          if (e.type === "delta") out += e.text;
          if (e.type === "error") throw new Error(e.message);
          if (e.type === "done") break;
        }
      } finally { run.kill(); }
      return out;
    },
    close() {},
  };
}

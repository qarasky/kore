#!/usr/bin/env bun
// A stand-in for the `claude` CLI in tests. It logs how it was called, then behaves as FAKE_CLAUDE_MODE says.
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const log = (o: object) => { if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(o) + "\n"); };

if (args[0] === "auth" && args[1] === "status") {
  const out = process.env.FAKE_CLAUDE_LOGGED_OUT === "1";
  console.log(JSON.stringify({ loggedIn: !out, authMethod: out ? "none" : "claude.ai", projectsDirectory: process.env.FAKE_CLAUDE_PROJECTS ?? "/nonexistent", email: "someone@example.test" }));
  process.exit(out ? 1 : 0);
}

const stdin = await new Response(Bun.stdin.stream()).text();
const mcpPath = args.includes("--mcp-config") ? args[args.indexOf("--mcp-config") + 1] : "";
let mcp: any = null, mcpMode = "";
try { mcp = JSON.parse(readFileSync(mcpPath, "utf8")); mcpMode = (statSync(mcpPath).mode & 0o777).toString(8); } catch { /* not a file */ }
log({ args, stdin, mcp, mcpMode, cwd: process.cwd(), env: { CLAUDECODE: process.env.CLAUDECODE ?? null, CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT ?? null, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null, MCP_TOOL_TIMEOUT: process.env.MCP_TOOL_TIMEOUT ?? null }, pid: process.pid });

const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
if (mode === "crash") { console.error("starting"); console.error("boom: something failed"); process.exit(1); }
if (mode === "hang") {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "x" }));
  await Bun.sleep(60_000);
  process.exit(0);
}
// ok: the recorded web-search answer
process.stdout.write(readFileSync(join(import.meta.dir, "claude-websearch.jsonl"), "utf8"));

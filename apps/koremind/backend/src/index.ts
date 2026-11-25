import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { listAddresses } from "./addresses";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { FakeEngine } from "./engine/fake";
import { CLAUDE_TITLE_MODEL, createClaudeEngine } from "./engine/claude";
import { createOpencodeEngine } from "./engine/opencode";
import { createRouter, type Route } from "./engine/router";
import { createApp } from "./http";
import { createServices } from "./services";
import { migrateLegacyDb } from "./legacy";

const config = loadConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });
migrateLegacyDb(config.dataDir);
// The local engines (Claude, OpenCode) reach KoreMind's notes tools over loopback with this per-run secret.
const mcpSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
const notesServer = { type: "remote", url: `http://127.0.0.1:${config.port}/mcp`, oauth: false, codemode: false, headers: { authorization: `Bearer ${mcpSecret}` }, timeout: { execution: 120_000 } };
// Demo behaviour for the fake engine: "note: buy milk" saves a note, "read <chat title>" reads another chat's notes,
// "remember: I like tea" saves a memory and "recall: tea" looks memory up.
const callTool = (sessionId: string, name: string, args: object) =>
  services.mcp.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: { "ai.opencode/sessionID": sessionId } } });
const engine = process.env.KOREMIND_FAKE_ENGINE
  ? new FakeEngine({
      reply: (a) => [{ type: "delta", text: `(fake engine) You said: ${a.text}` }], delayMs: 20, titleReply: "Fake engine chat", completeDelayMs: 400,
      during: async (a) => {
        const note = /^note:\s*(.+)/i.exec(a.text);
        if (note) await callTool(a.sessionId, "save_note", { title: note[1].slice(0, 40), body: note[1] });
        const read = /^read\s+(.+)/i.exec(a.text);
        if (read) await callTool(a.sessionId, "read_notes", { chat: read[1] });
        const remember = /^remember:\s*(.+)/i.exec(a.text);
        if (remember) await callTool(a.sessionId, "remember", { text: remember[1] });
        const recall = /^recall:?\s*(.*)/i.exec(a.text);
        if (recall) await callTool(a.sessionId, "recall_memory", recall[1] ? { query: recall[1] } : {});
      },
    })
  : await realEngine();

/** One engine per kind of provider in KOREMIND_PROVIDERS; OpenCode's server only starts when one of its providers is listed. */
async function realEngine() {
  const routes: Route[] = [];
  let opencode: Route | null = null;
  for (const id of config.providers) {
    if (id === "claude") {
      routes.push({ providers: ["claude"], engine: createClaudeEngine({ bin: config.claude.bin, configDir: config.claude.configDir || undefined, dataDir: config.dataDir, mcpUrl: `http://127.0.0.1:${config.port}/mcp`, mcpSecret }) });
    } else if (opencode) {
      opencode.providers.push(id);
    } else {
      opencode = { providers: [id], engine: await createOpencodeEngine({ dataDir: config.dataDir, bin: process.env.KOREMIND_OPENCODE_BIN, config: { mcp: { servers: { koremind: notesServer } } } }) };
      routes.push(opencode);
    }
  }
  return createRouter(routes, { titleModel: CLAUDE_TITLE_MODEL });
}

const version = (await Bun.file(join(import.meta.dir, "../package.json")).json()).version ?? "0.1.0";
let servicePort = config.port;
// eslint-disable-next-line prefer-const
const services = createServices({ db: openDb(join(config.dataDir, "koremind.sqlite")), dataDir: config.dataDir, engine, version, mcpSecret, oidc: config.oidc, apps: config.apps, addresses: () => listAddresses(networkInterfaces(), servicePort, process.env, config.host).map((a) => a.url) });
const app = createApp(services, { trustProxy: process.env.KOREMIND_TRUST_PROXY === "1" });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: 255,
  fetch: (req, srv) => app.fetch(req, srv.requestIP(req)?.address),
});

servicePort = server.port ?? config.port;
if (config.oidc) {
  const o = config.oidc;
  console.log(`Kore ID sign-in is on (${o.issuer}, client ${o.clientId}). In Kore ID's clients.json register redirectUris: ["${o.redirectUri}"] and backchannelLogoutUri: "${o.backchannelLogoutUri}".`);
  console.log(`  New accounts: ${o.autoProvision ? "anyone Kore ID lets into this app" : "first user and allow-list only"}${o.allowedEmails.length ? `, limited to ${o.allowedEmails.join(", ")}` : ""}. Owner of an empty instance: ${o.ownerEmail || "the first Kore ID account"}. Link by verified email: ${o.emailLink ? "on" : "off"}.`);
}
if (!config.oidc) console.log("Kore ID is not configured (KOREMIND_OIDC_ISSUER is empty). Nobody can sign in until it is set.");
console.log(`KoreMind backend ${version} is running${process.env.KOREMIND_FAKE_ENGINE ? " (fake engine)" : ` with ${config.providers.join(", ")}`} on ${config.host}. Point the apps at:`);
for (const a of listAddresses(networkInterfaces(), server.port ?? config.port, process.env, config.host)) console.log(`  ${a.label.padEnd(9)} ${a.url}`);

const stop = () => { engine.close(); server.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { createAuth } from "./auth";
import { createApprovals } from "./approvals";
import { createMcp } from "./mcp";
import { createNotes } from "./notes";
import { createChats } from "./chats";
import type { Engine } from "./engine/types";
import { createMemory } from "./memory";
import { createModels } from "./models";
import { createSettings } from "./settings";
import { createUploads } from "./uploads";

export type ServiceOptions = { db: Database; dataDir: string; engine: Engine; version: string; maxUploadBytes?: number; /** Shared secret the local engine presents on /mcp. */ mcpSecret?: string; approvalTimeoutMs?: number; /** Backend addresses a phone can use, best first. */ addresses?: () => string[] };

export function createServices(o: ServiceOptions) {
  const auth = createAuth(o.db);
  const settings = createSettings(o.db);
  const memory = createMemory(join(o.dataDir, "users"), o.engine, (u) => settings.get(u).memoryEnabled);
  const uploads = createUploads(o.db, join(o.dataDir, "uploads"), o.maxUploadBytes);
  const models = createModels(o.db, o.engine, (u) => settings.get(u));
  const approvals = createApprovals({ emit: (chatId, ev) => chats.emit(chatId, ev), timeoutMs: o.approvalTimeoutMs });
  const notes = createNotes(o.db, { ask: (a) => approvals.ask(a), emit: (chatId, a) => chats.emit(chatId, { type: "activity", ...a }) });
  const mcp = createMcp({ resolveSession: (sid) => chats.bySession(sid), notes });
  const mcpSecret = o.mcpSecret ?? Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  const chats = createChats(o.db, o.engine, {
    buildSystem: (u) => settings.buildSystem(settings.get(u), memory.list(u)),
    readUpload: (id, u) => uploads.read(id, u),
    onTurnComplete: (u, a, b, model) => { void memory.extractAfterTurn(u, a, b, model); },
    onTurnEnd: (chatId) => approvals.endTurn(chatId),
  });
  const addresses = o.addresses ?? (() => ["http://localhost:8787"]);
  return { db: o.db, engine: o.engine, version: o.version, addresses, approvals, notes, mcp, mcpSecret, auth, settings, memory, uploads, models, chats };
}
export type Services = ReturnType<typeof createServices>;

import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { createAuth } from "./auth";
import { createChats } from "./chats";
import type { Engine } from "./engine/types";
import { createMemory } from "./memory";
import { createModels } from "./models";
import { createSettings } from "./settings";
import { createUploads } from "./uploads";

export type ServiceOptions = { db: Database; dataDir: string; engine: Engine; version: string; maxUploadBytes?: number; /** Backend addresses a phone can use, best first. */ addresses?: () => string[] };

export function createServices(o: ServiceOptions) {
  const auth = createAuth(o.db);
  const settings = createSettings(o.db);
  const memory = createMemory(join(o.dataDir, "users"), o.engine, (u) => settings.get(u).memoryEnabled);
  const uploads = createUploads(o.db, join(o.dataDir, "uploads"), o.maxUploadBytes);
  const models = createModels(o.db, o.engine, (u) => settings.get(u));
  const chats = createChats(o.db, o.engine, {
    buildSystem: (u) => settings.buildSystem(settings.get(u), memory.list(u)),
    readUpload: (id, u) => uploads.read(id, u),
    onTurnComplete: (u, a, b, model) => { void memory.extractAfterTurn(u, a, b, model); },
  });
  const addresses = o.addresses ?? (() => ["http://localhost:8787"]);
  return { db: o.db, engine: o.engine, version: o.version, addresses, auth, settings, memory, uploads, models, chats };
}
export type Services = ReturnType<typeof createServices>;

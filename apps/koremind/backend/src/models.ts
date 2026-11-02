import type { Database } from "bun:sqlite";
import type { ProviderInfo, Settings } from "@zero/shared";
import type { Engine } from "./engine/types";

export function createModels(db: Database, engine: Engine, getSettings: (userId: string) => Settings) {
  /** Every offered provider for this user: disabled ones and unconnected ones come back empty, free-only ones are filtered. */
  const providers = async (userId: string): Promise<ProviderInfo[]> => {
    const s = getSettings(userId);
    return (await engine.listProviders()).map((p): ProviderInfo => {
      if (s.disabledProviders.includes(p.id)) return { ...p, status: "disabled", models: [] };
      if (p.status !== "ready") return { ...p, models: [] };
      if (!s.freeOnlyProviders.includes(p.id)) return p;
      const models = p.models.filter((m) => m.free);
      if (models.length && !models.some((m) => m.isDefault)) models[0] = { ...models[0], isDefault: true };
      return { ...p, models };
    });
  };
  return {
    providers,
    async allowed(userId: string, providerId: string, modelId: string): Promise<boolean> {
      return (await providers(userId)).some((p) => p.id === providerId && p.status === "ready" && p.models.some((m) => m.id === modelId));
    },
    connections: () => engine.listConnections(),
    startSignIn: (id: string) => engine.startSignIn(id),
    signInStatus: (id: string, attemptId: string) => engine.signInStatus(id, attemptId),
    connect: (id: string, key: string) => engine.setProviderKey(id, key),
    disconnect: (id: string) => engine.removeProviderKey(id),
    favorites(userId: string): string[] {
      return (db.query("select model_key from favorites where user_id=? order by rowid").all(userId) as { model_key: string }[]).map((r) => r.model_key);
    },
    async setFavorites(userId: string, keys: string[]) {
      const valid = new Set((await providers(userId)).flatMap((p) => (p.status === "ready" ? p.models.map((m) => `${p.id}/${m.id}`) : [])));
      const clean = [...new Set(keys.filter((k) => valid.has(k)))];
      db.transaction(() => {
        db.run("delete from favorites where user_id=?", [userId]);
        for (const k of clean) db.run("insert into favorites(user_id,model_key) values(?,?)", [userId, k]);
      })();
    },
  };
}
export type Models = ReturnType<typeof createModels>;

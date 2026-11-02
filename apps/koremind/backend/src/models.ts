import type { Database } from "bun:sqlite";
import type { ProviderInfo } from "@zero/shared";
import type { Engine } from "./engine/types";

export function createModels(db: Database, engine: Engine) {
  const providers = (): Promise<ProviderInfo[]> => engine.listProviders();
  return {
    providers,
    connections: () => engine.listConnections(),
    startSignIn: (id: string) => engine.startSignIn(id),
    signInStatus: (id: string, attemptId: string) => engine.signInStatus(id, attemptId),
    connect: (id: string, key: string) => engine.setProviderKey(id, key),
    disconnect: (id: string) => engine.removeProviderKey(id),
    favorites(userId: string): string[] {
      return (db.query("select model_key from favorites where user_id=? order by rowid").all(userId) as { model_key: string }[]).map((r) => r.model_key);
    },
    async setFavorites(userId: string, keys: string[]) {
      const valid = new Set((await providers()).flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`)));
      const clean = [...new Set(keys.filter((k) => valid.has(k)))];
      db.transaction(() => {
        db.run("delete from favorites where user_id=?", [userId]);
        for (const k of clean) db.run("insert into favorites(user_id,model_key) values(?,?)", [userId, k]);
      })();
    },
  };
}
export type Models = ReturnType<typeof createModels>;

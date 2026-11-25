import type { ProviderConnection, ProviderInfo } from "@koremind/shared";
import type { Engine, EngineEvent, ModelRef, PromptArgs } from "./types";

export type Route = { providers: string[]; engine: Engine };

/**
 * One Engine over several (Claude's CLI, OpenCode): each call goes to the engine that runs its provider. Only the providers a
 * route lists are visible, in route order, so KOREMIND_PROVIDERS decides what the apps see.
 */
export function createRouter(routes: Route[], opts: { titleModel?: ModelRef } = {}): Engine {
  const byProvider = new Map<string, Engine>();
  for (const r of routes) for (const p of r.providers) if (!byProvider.has(p)) byProvider.set(p, r.engine);
  const bySession = new Map<string, Engine>();
  const warned = new Set<Engine>();
  const first = () => routes[0]?.engine;

  async function gather<T extends { id: string }>(get: (e: Engine) => Promise<T[]>): Promise<T[]> {
    const lists = await Promise.all(routes.map(async (r) => {
      try {
        const items = await get(r.engine);
        warned.delete(r.engine);
        return items.filter((x) => r.providers.includes(x.id));
      } catch (e) {
        if (!warned.has(r.engine)) { warned.add(r.engine); console.error(`engine for ${r.providers.join(", ")} is unavailable:`, e instanceof Error ? e.message : e); }
        return [];
      }
    }));
    return lists.flat();
  }

  return {
    listProviders: () => gather<ProviderInfo>((e) => e.listProviders()),
    listConnections: () => gather<ProviderConnection>((e) => e.listConnections()),
    async createSession(model) {
      const engine = model ? byProvider.get(model.providerId) : first();
      if (!engine) throw new Error(`provider not enabled: ${model?.providerId ?? "(none)"}`);
      const id = await engine.createSession(model);
      bySession.set(id, engine);
      return id;
    },
    async deleteSession(id) {
      const engine = bySession.get(id);
      bySession.delete(id);
      for (const e of engine ? [engine] : routes.map((r) => r.engine)) await e.deleteSession(id).catch(() => {});
    },
    async *prompt(a: PromptArgs): AsyncIterable<EngineEvent> {
      const engine = byProvider.get(a.model.providerId);
      if (!engine) { yield { type: "error", message: "That provider isn't enabled on this server.", noProvider: true }; return; }
      bySession.set(a.sessionId, engine);
      yield* engine.prompt(a);
    },
    complete(a) {
      // Only a chat already on the title model's provider is titled there: Claude is owner-only, so nobody else's chat goes to it.
      const title = a.kind === "title" && opts.titleModel && a.model?.providerId === opts.titleModel.providerId && byProvider.has(opts.titleModel.providerId) ? opts.titleModel : null;
      const model = title ?? a.model;
      const engine = model ? byProvider.get(model.providerId) : first();
      if (!engine) return Promise.reject(new Error(`provider not enabled: ${model?.providerId ?? "(none)"}`));
      return engine.complete({ ...a, model, ...(title ? { thinking: undefined } : {}) });
    },
    close() { for (const r of routes) r.engine.close(); },
  };
}

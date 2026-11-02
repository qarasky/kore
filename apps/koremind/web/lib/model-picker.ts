import type { ModelInfo, ProviderInfo } from "@zero/shared";
import { t } from "./strings";

export type PickerRow = { key: string; providerId: string; providerName: string; model: ModelInfo };

/** Rows for the picker. `rail` is "favorites" or a provider id. */
export function filterModels(providers: ProviderInfo[], favorites: string[], rail: string, query: string): PickerRow[] {
  const q = query.trim().toLowerCase();
  const rows = providers.filter(isReady).flatMap((p) => p.models.map((model) => ({ key: `${p.id}/${model.id}`, providerId: p.id, providerName: p.name, model })));
  const inRail = rail === "favorites" ? rows.filter((r) => favorites.includes(r.key)) : rows.filter((r) => r.providerId === rail);
  return inRail.filter((r) => !q || r.model.name.toLowerCase().includes(q) || r.model.id.toLowerCase().includes(q));
}

export const thinkingLabel = (level: string | undefined) => (level ? level.charAt(0).toUpperCase() + level.slice(1) : "");
export const chipLabel = (modelName: string, level: string | undefined) => [modelName, thinkingLabel(level)].filter(Boolean).join(" ");

/** True when a photo is attached but the chosen model can't read photos. */
export const lacksVision = (attachments: { mime: string }[], model: ModelInfo | undefined): boolean =>
  !!model && !model.vision && attachments.some((a) => a.mime.startsWith("image/"));

export const isReady = (p: ProviderInfo) => p.status === "ready";

/** Which bundled logo a provider uses. Codex runs on OpenAI, so it shares OpenAI's mark. */
export type ProviderIconKey = "opencode" | "openai" | "openrouter";
export const providerIconKey = (id: string): ProviderIconKey | null => (id === "opencode" || id === "openai" || id === "openrouter" ? id : null);

/** Providers that can't be used right now stay on the rail but are dimmed. */
export const railDimmed = (p: ProviderInfo) => !isReady(p);

/** The explanation shown instead of model rows for a provider that isn't ready; null when it is. */
export function railNotice(p: ProviderInfo): string | null {
  if (isReady(p)) return null;
  return p.status === "disabled" ? t.providerDisabled(p.name) : t.providerNeedsConnection(p.name);
}

/** Where the picker opens: favorites if a usable one is pinned, else the current provider, else the first ready one. */
export function initialRail(providers: ProviderInfo[], favorites: string[], choice: { providerId: string } | null): string {
  const ready = providers.filter(isReady);
  if (ready.some((p) => p.models.some((m) => favorites.includes(`${p.id}/${m.id}`)))) return "favorites";
  const current = choice && ready.find((p) => p.id === choice.providerId);
  return current?.id ?? ready[0]?.id ?? "favorites";
}

export const isChoiceAllowed = (providers: ProviderInfo[], providerId: string, modelId: string) =>
  providers.some((p) => p.id === providerId && isReady(p) && p.models.some((m) => m.id === modelId));

/** The model to fall back to: the default of the first ready provider that has models. */
export function defaultChoice(providers: ProviderInfo[]): { providerId: string; modelId: string } | null {
  const p = providers.find((x) => isReady(x) && x.models.length > 0);
  const m = p?.models.find((x) => x.isDefault) ?? p?.models[0];
  return p && m ? { providerId: p.id, modelId: m.id } : null;
}

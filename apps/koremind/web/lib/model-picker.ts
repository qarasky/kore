import type { ModelInfo, ProviderInfo } from "@zero/shared";

export type PickerRow = { key: string; providerId: string; providerName: string; model: ModelInfo };

/** Rows for the picker. `rail` is "favorites" or a provider id. */
export function filterModels(providers: ProviderInfo[], favorites: string[], rail: string, query: string): PickerRow[] {
  const q = query.trim().toLowerCase();
  const rows = providers.flatMap((p) => p.models.map((model) => ({ key: `${p.id}/${model.id}`, providerId: p.id, providerName: p.name, model })));
  const inRail = rail === "favorites" ? rows.filter((r) => favorites.includes(r.key)) : rows.filter((r) => r.providerId === rail);
  return inRail.filter((r) => !q || r.model.name.toLowerCase().includes(q) || r.model.id.toLowerCase().includes(q));
}

export const thinkingLabel = (level: string | undefined) => (level ? level.charAt(0).toUpperCase() + level.slice(1) : "");
export const chipLabel = (modelName: string, level: string | undefined) => [modelName, thinkingLabel(level)].filter(Boolean).join(" ");

/** True when a photo is attached but the chosen model can't read photos. */
export const lacksVision = (attachments: { mime: string }[], model: ModelInfo | undefined): boolean =>
  !!model && !model.vision && attachments.some((a) => a.mime.startsWith("image/"));

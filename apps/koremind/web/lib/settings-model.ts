import type { Settings } from "@zero/shared";
import { t } from "./strings";

/** Settings stay short: five sections, one visible at a time. */
export const SECTIONS = [
  { id: "models", label: t.sectionModels },
  { id: "providers", label: t.sectionProviders },
  { id: "personalization", label: t.personalization },
  { id: "memory", label: t.memory },
  { id: "account", label: t.account },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];
export const isSection = (v: string): v is SectionId => SECTIONS.some((s) => s.id === v);

/** Presets are named by outcome, not by parameters. Free text stays available for anything else. */
export const TONE_PRESETS = [
  { id: "direct", label: "Short and direct", tone: "Short and direct. No filler." },
  { id: "friendly", label: "Friendly", tone: "Warm and friendly, like a good friend." },
  { id: "formal", label: "Formal", tone: "Formal and precise." },
  { id: "playful", label: "Playful", tone: "Playful, with a light sense of humor." },
] as const;

export const activePreset = (tone: string): string | null => TONE_PRESETS.find((p) => p.tone === tone)?.id ?? null;
export function togglePreset(tone: string, id: string): string {
  const p = TONE_PRESETS.find((x) => x.id === id);
  if (!p) return tone;
  return tone === p.tone ? "" : p.tone;
}

export type ProviderState = "on" | "off" | "free";
export function providerStatus(p: { id: string; connected: boolean }): ProviderState {
  if (p.connected) return "on";
  return p.id === "opencode" ? "free" : "off";
}

/** Turns an id on or off in a list without duplicates. */
export const toggleInList = (list: string[], id: string, on: boolean): string[] => (on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id));
export const providerEnabled = (s: Settings, id: string) => !s.disabledProviders.includes(id);
export const withProviderEnabled = (s: Settings, id: string, enabled: boolean): Settings => ({ ...s, disabledProviders: toggleInList(s.disabledProviders, id, !enabled) });
export const freeOnly = (s: Settings, id: string) => s.freeOnlyProviders.includes(id);
export const withFreeOnly = (s: Settings, id: string, on: boolean): Settings => ({ ...s, freeOnlyProviders: toggleInList(s.freeOnlyProviders, id, on) });
/** True when a change touched what the model picker shows, so it must be reloaded. */
export const providerPrefsChanged = (a: Settings, b: Settings) =>
  JSON.stringify([a.disabledProviders, a.freeOnlyProviders]) !== JSON.stringify([b.disabledProviders, b.freeOnlyProviders]);

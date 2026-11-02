import { expect, test } from "bun:test";
import { SECTIONS, TONE_PRESETS, activePreset, providerStatus, togglePreset } from "../lib/settings-model";

test("sections are few and ordered: models, providers, personalization, memory, account", () => {
  expect(SECTIONS.map((s) => s.id)).toEqual(["models", "providers", "personalization", "memory", "account"]);
});

test("a preset sets the tone, picking it again clears it, and typed text matches no preset", () => {
  const p = TONE_PRESETS[0];
  expect(togglePreset("", p.id)).toBe(p.tone);
  expect(activePreset(p.tone)).toBe(p.id);
  expect(togglePreset(p.tone, p.id)).toBe("");
  expect(activePreset("talk like a pirate")).toBeNull();
  expect(togglePreset("talk like a pirate", TONE_PRESETS[1].id)).toBe(TONE_PRESETS[1].tone);
});

test("provider status line explains the state in plain words", () => {
  expect(providerStatus({ id: "opencode", connected: false })).toBe("free");
  expect(providerStatus({ id: "openai", connected: false })).toBe("off");
  expect(providerStatus({ id: "openrouter", connected: true })).toBe("on");
});

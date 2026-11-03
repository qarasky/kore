import { expect, test } from "bun:test";
import type { ModelInfo, ProviderInfo, Settings } from "@koremind/shared";
import { defaultChoice, filterModels, initialRail, isChoiceAllowed, isReady, providerIconKey, railDimmed, railNotice } from "../lib/model-picker";
import { freeOnly, providerEnabled, toggleInList, withFreeOnly, withProviderEnabled } from "../lib/settings-model";

const m = (id: string, free = false, isDefault = false): ModelInfo => ({ id, name: id.toUpperCase(), vision: false, thinkingLevels: [], isDefault, free });
const opencode: ProviderInfo = { id: "opencode", name: "OpenCode", connected: false, status: "ready", models: [m("big", true, true)] };
const codex: ProviderInfo = { id: "openai", name: "Codex", connected: false, status: "needs_connection", models: [] };
const router: ProviderInfo = { id: "openrouter", name: "OpenRouter", connected: true, status: "disabled", models: [m("a/free:free", true), m("b/paid")] };
const all = [opencode, codex, router];
const settings: Settings = { memoryEnabled: true, displayName: "", tone: "", about: "", disabledProviders: [], freeOnlyProviders: [] };

test("each known provider has a real logo key and unknown ones fall back to the initial", () => {
  expect(providerIconKey("opencode")).toBe("opencode");
  expect(providerIconKey("openai")).toBe("openai"); // Codex runs on OpenAI; there is no separate Codex logo
  expect(providerIconKey("openrouter")).toBe("openrouter");
  expect(providerIconKey("something-else")).toBeNull();
});

test("only ready providers are full strength; the others explain why", () => {
  expect([opencode, codex, router].map(isReady)).toEqual([true, false, false]);
  expect([opencode, codex, router].map(railDimmed)).toEqual([false, true, true]);
  expect(railNotice(opencode)).toBeNull();
  expect(railNotice(codex)).toBe("Connect Codex in Settings to use its models.");
  expect(railNotice(router)).toBe("OpenRouter is turned off in Settings.");
});

test("favorites and provider rails never list models of a provider that is not ready", () => {
  const favs = ["opencode/big", "openrouter/b/paid"];
  expect(filterModels(all, favs, "favorites", "").map((r) => r.key)).toEqual(["opencode/big"]);
  expect(filterModels(all, favs, "openrouter", "")).toEqual([]);
});

test("the picker opens on favorites when a ready provider has one, else on the current or first ready provider", () => {
  expect(initialRail(all, ["opencode/big"], null)).toBe("favorites");
  expect(initialRail(all, ["openrouter/b/paid"], { providerId: "opencode", modelId: "big" })).toBe("opencode");
  expect(initialRail(all, [], { providerId: "openai", modelId: "x" })).toBe("opencode");
  expect(initialRail([], [], null)).toBe("favorites");
});

test("a saved choice is only allowed while its provider is ready and the model exists; else fall back to the first ready default", () => {
  expect(isChoiceAllowed(all, "opencode", "big")).toBe(true);
  expect(isChoiceAllowed(all, "openrouter", "b/paid")).toBe(false);
  expect(isChoiceAllowed(all, "opencode", "gone")).toBe(false);
  expect(defaultChoice(all)).toEqual({ providerId: "opencode", modelId: "big" });
  expect(defaultChoice([codex, router])).toBeNull();
});

test("provider switches edit the Settings lists without duplicates and without touching other providers", () => {
  expect(toggleInList(["a"], "b", true)).toEqual(["a", "b"]);
  expect(toggleInList(["a", "b"], "b", true)).toEqual(["a", "b"]);
  expect(toggleInList(["a", "b"], "a", false)).toEqual(["b"]);
  const off = withProviderEnabled(settings, "openrouter", false);
  expect(off.disabledProviders).toEqual(["openrouter"]);
  expect(providerEnabled(off, "openrouter")).toBe(false);
  expect(providerEnabled(off, "opencode")).toBe(true);
  expect(withProviderEnabled(off, "openrouter", true).disabledProviders).toEqual([]);
  const free = withFreeOnly(settings, "opencode", true);
  expect(freeOnly(free, "opencode")).toBe(true);
  expect(freeOnly(free, "openrouter")).toBe(false);
  expect(free.disabledProviders).toEqual([]);
});

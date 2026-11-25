import { expect, test } from "bun:test";
import type { ModelInfo, ProviderInfo, Settings } from "@koremind/shared";
import { defaultChoice, filterModels, initialRail, isChoiceAllowed, isReady, providerIconKey, railDimmed, railNotice, railProviders } from "../lib/model-picker";
import { freeOnly, providerEnabled, toggleInList, withFreeOnly, withProviderEnabled } from "../lib/settings-model";

const m = (id: string, free = false, isDefault = false): ModelInfo => ({ id, name: id.toUpperCase(), vision: false, thinkingLevels: [], isDefault, free });
const opencode: ProviderInfo = { id: "opencode", name: "OpenCode", connected: false, status: "ready", models: [m("big", true, true)] };
const claude: ProviderInfo = { id: "claude", name: "Claude", connected: false, status: "needs_connection", models: [] };
const go: ProviderInfo = { id: "opencode-go", name: "OpenCode Go", connected: true, status: "disabled", models: [m("a/free:free", true), m("b/paid")] };
const all = [opencode, claude, go];
const settings: Settings = { memoryEnabled: true, displayName: "", tone: "", about: "", disabledProviders: [], freeOnlyProviders: [] };

test("OpenCode has its logo; Claude and unknown providers fall back to the initial", () => {
  expect(providerIconKey("opencode")).toBe("opencode");
  expect(providerIconKey("opencode-go")).toBe("opencode"); // Go is OpenCode's plan: same mark
  expect(providerIconKey("claude")).toBeNull(); // no Anthropic logo without permission
  for (const gone of ["groq", "openai", "openrouter", "something-else"]) expect(providerIconKey(gone)).toBeNull();
});

test("only ready providers are full strength; the others explain why", () => {
  expect([opencode, claude, go].map(isReady)).toEqual([true, false, false]);
  expect([opencode, claude, go].map(railDimmed)).toEqual([false, true, true]);
  expect(railNotice(opencode)).toBeNull();
  expect(railNotice(claude)).toBe("Claude isn't signed in on the server yet.");
  expect(railNotice(go)).toBe("OpenCode Go is turned off in Settings.");
});

test("a provider that is turned off is not on the rail at all; one that isn't signed in stays, dimmed", () => {
  expect(railProviders(all).map((p) => p.id)).toEqual(["opencode", "claude"]);
  expect(railProviders([go])).toEqual([]);
});

test("favorites and provider rails never list models of a provider that is not ready", () => {
  const favs = ["opencode/big", "opencode-go/b/paid"];
  expect(filterModels(all, favs, "favorites", "").map((r) => r.key)).toEqual(["opencode/big"]);
  expect(filterModels(all, favs, "opencode-go", "")).toEqual([]);
});

test("the picker opens on favorites when a ready provider has one, else on the current or first ready provider", () => {
  expect(initialRail(all, ["opencode/big"], null)).toBe("favorites");
  expect(initialRail(all, ["opencode-go/b/paid"], { providerId: "opencode", modelId: "big" })).toBe("opencode");
  expect(initialRail(all, [], { providerId: "claude", modelId: "x" })).toBe("opencode");
  expect(initialRail([], [], null)).toBe("favorites");
});

test("a saved choice is only allowed while its provider is ready and the model exists; else fall back to the first ready default", () => {
  expect(isChoiceAllowed(all, "opencode", "big")).toBe(true);
  expect(isChoiceAllowed(all, "opencode-go", "b/paid")).toBe(false);
  expect(isChoiceAllowed(all, "opencode", "gone")).toBe(false);
  expect(defaultChoice(all)).toEqual({ providerId: "opencode", modelId: "big" });
  expect(defaultChoice([claude, go])).toBeNull();
});

test("provider switches edit the Settings lists without duplicates and without touching other providers", () => {
  expect(toggleInList(["a"], "b", true)).toEqual(["a", "b"]);
  expect(toggleInList(["a", "b"], "b", true)).toEqual(["a", "b"]);
  expect(toggleInList(["a", "b"], "a", false)).toEqual(["b"]);
  const off = withProviderEnabled(settings, "opencode-go", false);
  expect(off.disabledProviders).toEqual(["opencode-go"]);
  expect(providerEnabled(off, "opencode-go")).toBe(false);
  expect(providerEnabled(off, "opencode")).toBe(true);
  expect(withProviderEnabled(off, "opencode-go", true).disabledProviders).toEqual([]);
  const free = withFreeOnly(settings, "opencode", true);
  expect(freeOnly(free, "opencode")).toBe(true);
  expect(freeOnly(free, "opencode-go")).toBe(false);
  expect(free.disabledProviders).toEqual([]);
});

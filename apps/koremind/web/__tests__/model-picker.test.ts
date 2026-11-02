import { expect, test } from "bun:test";
import type { ProviderInfo } from "@zero/shared";
import { chipLabel, filterModels, thinkingLabel } from "../lib/model-picker";

const providers: ProviderInfo[] = [
  { id: "opencode", name: "OpenCode", connected: true, models: [
    { id: "fast", name: "Fast One", vision: false, thinkingLevels: [], isDefault: true },
    { id: "deep", name: "Deep Think", vision: true, thinkingLevels: ["low", "high"], isDefault: false },
  ] },
  { id: "other", name: "Other", connected: true, models: [{ id: "x", name: "Xtra", vision: false, thinkingLevels: [], isDefault: true }] },
];

test("filterModels favorites rail returns only favorited models", () => {
  const rows = filterModels(providers, ["opencode/deep", "other/x"], "favorites", "");
  expect(rows.map((r) => r.key)).toEqual(["opencode/deep", "other/x"]);
});

test("filterModels search matches name case-insensitively", () => {
  expect(filterModels(providers, [], "opencode", "THINK").map((r) => r.key)).toEqual(["opencode/deep"]);
});

test("filterModels provider rail ignores favorites and other providers", () => {
  const rows = filterModels(providers, ["other/x"], "opencode", "");
  expect(rows.map((r) => r.key)).toEqual(["opencode/fast", "opencode/deep"]);
});

test("filterModels search with no match returns empty", () => {
  expect(filterModels(providers, [], "opencode", "zzz")).toEqual([]);
});

test("thinkingLabel defaults to empty for undefined and capitalizes", () => {
  expect(thinkingLabel(undefined)).toBe("");
  expect(thinkingLabel("high")).toBe("High");
});

test("chipLabel joins model and thinking level", () => {
  expect(chipLabel("Deep Think", "high")).toBe("Deep Think High");
  expect(chipLabel("Fast One", undefined)).toBe("Fast One");
});

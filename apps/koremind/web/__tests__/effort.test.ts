import { expect, test } from "bun:test";
import { effortAt, effortIndex, effortLabel, effortStops } from "../lib/effort";

test("effortStops puts Default first, then the model's levels", () => {
  expect(effortStops(["low", "high"])).toEqual([undefined, "low", "high"]);
  expect(effortStops([])).toEqual([undefined]);
});

test("effortIndex finds the level and falls back to Default for one the model doesn't offer", () => {
  expect(effortIndex(["low", "high"], "high")).toBe(2);
  expect(effortIndex(["low", "high"], "xhigh")).toBe(0);
  expect(effortIndex(["low"], undefined)).toBe(0);
});

test("effortAt clamps the index to the stops", () => {
  expect(effortAt(["low", "high"], 9)).toBe("high");
  expect(effortAt(["low"], -3)).toBeUndefined();
  expect(effortAt(["low", "high"], 1)).toBe("low");
});

test("effortLabel names the level", () => {
  expect(effortLabel("high")).toBe("High effort");
  expect(effortLabel(undefined)).toBe("Default effort");
});

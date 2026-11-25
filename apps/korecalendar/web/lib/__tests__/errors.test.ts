import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import en from "@/lib/i18n/en";

// The API's documented error codes (x-error-codes in docs/openapi.yaml). The
// web must have a message for every one, so a new code cannot ship unmapped.
function documentedCodes(): string[] {
  const yaml = readFileSync(new URL("../../../docs/openapi.yaml", import.meta.url), "utf8");
  const block = yaml.split("x-error-codes:")[1].split(/\npaths:/)[0];
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
}

describe("errorMessage", () => {
  it("has a message for every documented API error code", () => {
    const codes = documentedCodes();
    expect(codes.length).toBeGreaterThan(10);
    for (const code of codes) {
      expect(Object.keys(en), `a message for error.${code}`).toContain(`error.${code}`);
      if (code !== "rate_limited") {
        // (the rate-limit message has a placeholder; it has its own test below)
        expect(errorMessage(new ApiError(400, code))).toBe(en[`error.${code}` as keyof typeof en]);
      }
    }
  });

  it("explains an unreachable server", () => {
    expect(errorMessage(new ApiError(503, "unreachable"))).toBe(en["error.unreachable"]);
  });

  it("falls back to a generic message for unknown codes and non-API errors", () => {
    expect(errorMessage(new ApiError(418, "teapot"))).toBe(en["error.generic"]);
    expect(errorMessage(new Error("boom"))).toBe(en["error.generic"]);
    expect(errorMessage("weird")).toBe(en["error.generic"]);
  });

  it("tells the person how long to wait when rate limited", () => {
    const msg = errorMessage(new ApiError(429, "rate_limited", 900));
    expect(msg).toContain("15");
  });
});

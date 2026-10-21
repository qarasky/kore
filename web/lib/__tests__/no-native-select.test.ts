import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

describe("custom Select only", () => {
  it("no native <select> in app/ or components/ outside components/Select.tsx", () => {
    const offenders = ["app", "components"]
      .flatMap((d) => sources(join(root, d)))
      .filter((p) => relative(root, p) !== join("components", "Select.tsx"))
      .filter((p) => /<select[\s>]/.test(readFileSync(p, "utf8")))
      .map((p) => relative(root, p));
    expect(offenders).toEqual([]);
  });
});

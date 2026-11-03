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

describe("kore-ui primitives only", () => {
  const files = () => ["app", "components"].flatMap((d) => sources(join(root, d)));

  it("no native <select> or <dialog> in app/ or components/ (kore-ui Select and Dialog)", () => {
    const offenders = files()
      .filter((p) => /<(select|dialog)[\s>]/.test(readFileSync(p, "utf8")))
      .map((p) => relative(root, p));
    expect(offenders).toEqual([]);
  });

  it("the local copies replaced by kore-ui stay deleted", () => {
    const gone = ["Modal", "ConfirmDialog", "Menu", "ContextMenu", "Select", "Toast", "EmptyState", "icons", "wordmark"];
    const present = gone.filter((name) => files().some((p) => relative(root, p) === join("components", `${name}.tsx`)));
    expect(present).toEqual([]);
  });
});

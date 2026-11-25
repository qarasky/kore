import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { isNumericColumn, parseCard } from "../src/cards";

// The same fixtures are run by the Android tests (CardTest.kt): both clients must read a card identically.
const fixtures: { name: string; raw: string; card: unknown }[] = JSON.parse(readFileSync(new URL("../fixtures/cards.json", import.meta.url), "utf8"));

for (const f of fixtures) {
  test(`card fixture: ${f.name}`, () => {
    expect(parseCard(f.raw)).toEqual(f.card as never);
  });
}

test("numeric columns are right-aligned, text columns are not", () => {
  expect(isNumericColumn([["€60,000"], ["€6,667"], ["—"]], 0)).toBe(true);
  expect(isNumericColumn([["3.29M–4.89M"], ["€1.22M"]], 0)).toBe(true);
  expect(isNumericColumn([["12%"], ["-4.5%"], ["+3"]], 0)).toBe(true);
  expect(isNumericColumn([["1.7× growth"], ["2"]], 0)).toBe(false);
  expect(isNumericColumn([["Skyler"], ["Anuar"]], 0)).toBe(false);
  expect(isNumericColumn([["12"], ["n/a"]], 0)).toBe(false);
  expect(isNumericColumn([], 0)).toBe(false);
  expect(isNumericColumn([["12"], []], 0)).toBe(true); // a short row doesn't decide
  expect(isNumericColumn([["60\u00a0000"], ["€\u202f6 667"]], 0)).toBe(true); // no-break and thin spaces are spaces
});

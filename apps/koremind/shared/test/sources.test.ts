import { expect, test } from "bun:test";
import { addSource, dedupeSources, sourceHost, sourceKey } from "../src/sources";

test("the same page gives the same key despite tracking, fragments, www and trailing slashes", () => {
  const k = sourceKey("https://runpod.io/pricing");
  for (const u of ["https://www.runpod.io/pricing/", "https://runpod.io/pricing#gpu", "https://RUNPOD.io/pricing?utm_source=x&utm_medium=y", "https://runpod.io/pricing?srsltid=abc"]) expect(sourceKey(u)).toBe(k);
  expect(sourceKey("https://runpod.io/pricing?b=2&a=1")).toBe(sourceKey("https://runpod.io/pricing?a=1&b=2"));
  expect(sourceKey("https://runpod.io/pricing?gpu=h100")).not.toBe(k);
  expect(sourceKey("not a url")).toBe("not a url");
});

test("repeats are dropped, first one kept, order kept", () => {
  const list = [
    { title: "Gemini API Pricing 2026", url: "https://example.com/gemini?utm_source=a" },
    { title: "Runpod pricing", url: "https://runpod.io/pricing" },
    { title: "Gemini API Pricing 2026", url: "https://example.com/gemini/" },
    { title: "gemini api pricing 2026 ", url: "https://example.com/gemini-pricing" }, // same title on the same site
    { title: "Gemini API Pricing 2026", url: "https://other.org/gemini" }, // same title elsewhere is another page
    { title: "Runpod pricing", url: "https://www.runpod.io/pricing" },
  ];
  expect(dedupeSources(list).map((s) => s.url)).toEqual(["https://example.com/gemini?utm_source=a", "https://runpod.io/pricing", "https://other.org/gemini"]);
});

test("adding a known source changes nothing", () => {
  const a = [{ title: "A", url: "https://a.com/x" }];
  expect(addSource(a, { title: "A again", url: "https://www.a.com/x/" })).toBe(a);
  expect(addSource(a, { title: "B", url: "https://b.com" })).toHaveLength(2);
});

test("the list shows the site without www", () => {
  expect(sourceHost("https://www.runpod.io/pricing")).toBe("runpod.io");
  expect(sourceHost("nope")).toBe("");
});

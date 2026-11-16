import { expect, test } from "bun:test";
import { barTone, fenceLanguage, hastText, hostOf, numericColumnsPlugin, safeImageSrc, TONE_FILL, TONE_PILL, TONE_TEXT, type HastNode } from "../lib/rich-ui";

test("every tone has a text colour, a pill and a bar fill", () => {
  for (const tone of ["neutral", "good", "warn", "bad", "info"] as const) {
    expect(TONE_TEXT[tone]).toBeTruthy();
    expect(TONE_PILL[tone]).toBeTruthy();
    expect(TONE_FILL[tone]).toBeTruthy();
  }
});

test("bars without a tone cycle green, blue, amber; a given tone wins", () => {
  expect([0, 1, 2, 3].map((i) => barTone(undefined, i))).toEqual(["good", "info", "warn", "good"]);
  expect(barTone("bad", 0)).toBe("bad");
});

test("only https images are drawn, and the chip shows the host without www", () => {
  expect(safeImageSrc("https://tensor.art/x.png")).toBe("https://tensor.art/x.png");
  expect(safeImageSrc("http://tensor.art/x.png")).toBeNull();
  expect(safeImageSrc("javascript:alert(1)")).toBeNull();
  expect(safeImageSrc("data:image/png;base64,AAAA")).toBeNull();
  expect(safeImageSrc(undefined)).toBeNull();
  expect(hostOf("https://www.tensor.art/x/y.png")).toBe("tensor.art");
  expect(hostOf("not a url")).toBe("");
});

test("the fence language comes from the class list", () => {
  expect(fenceLanguage(["language-card"])).toBe("card");
  expect(fenceLanguage(["foo", "language-ts"])).toBe("ts");
  expect(fenceLanguage(undefined)).toBe("");
  expect(fenceLanguage("language-card")).toBe("card"); // tolerate a string
});

const text = (value: string): HastNode => ({ type: "text", value });
const el = (tagName: string, children: HastNode[] = []): HastNode => ({ type: "element", tagName, properties: {}, children });

test("hastText joins all text under a node", () => {
  expect(hastText(el("code", [text("a"), el("b", [text("b")]), text("c")]))).toBe("abc");
});

test("a table column that is all numbers gets the num class on its header and cells; others do not", () => {
  const row = (tag: "th" | "td", ...cells: string[]) => el("tr", cells.map((c) => el(tag, [text(c)])));
  const table = el("table", [
    el("thead", [row("th", "Source", "Annual")]),
    el("tbody", [row("td", "Dividends", "€60,000"), row("td", "Salary", "€91,000"), row("td", "Café", "€0")]),
  ]);
  numericColumnsPlugin()({ type: "root", children: [table] });
  const cells = (tr: HastNode) => (tr.children ?? []);
  const [head, body] = table.children!;
  expect(cells(head.children![0]).map((c) => c.properties?.className ?? null)).toEqual([null, ["num"]]);
  for (const tr of body.children!) expect(cells(tr).map((c) => c.properties?.className ?? null)).toEqual([null, ["num"]]);
});

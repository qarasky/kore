import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { androidForeground, markSvg } from "./icons";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("markSvg is a rounded dark tile with four accent arcs on Kore's opacity ramp", () => {
  const svg = markSvg();
  expect(svg).toContain('fill="#16181d"');
  expect(svg).toContain('stroke="#5b8def"');
  expect(svg.match(/<path /g)).toHaveLength(4);
  for (const o of ["0.6", "0.3"]) expect(svg).toContain(`opacity="${o}"`);
});

test("androidForeground draws the same four arcs with alpha colors", () => {
  const xml = androidForeground();
  expect(xml.match(/<path /g)).toHaveLength(4);
  expect(xml).toContain('#5b8def"');
  expect(xml).toContain("#995b8def");
  expect(xml).toContain("#4d5b8def");
});

test("committed icon files equal generator output (never hand-edit them)", () => {
  expect(read("assets/mark.svg")).toBe(markSvg());
  expect(read("web/app/icon.svg")).toBe(markSvg());
  expect(read("android/app/src/main/res/drawable/ic_launcher_foreground.xml")).toBe(androidForeground());
});

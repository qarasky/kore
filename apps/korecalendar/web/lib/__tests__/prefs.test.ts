import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, readPrefs } from "@/lib/prefs";

describe("readPrefs", () => {
  it("defaults when there are no cookies", () => {
    expect(readPrefs("")).toEqual(DEFAULT_PREFS);
  });

  it("reads valid values from a cookie string", () => {
    const p = readPrefs("a=b; kc_view=month; kc_weekstart=sun; kc_clock=12h; kc_hidden=aaaaaaaa11112222%2Cbbbbbbbb33334444");
    expect(p).toEqual({ view: "month", weekStart: "sun", clock: "12h", hidden: ["aaaaaaaa11112222", "bbbbbbbb33334444"] });
  });

  it("ignores invalid values instead of trusting them", () => {
    const p = readPrefs("kc_view=year; kc_weekstart=fri; kc_clock=25h; kc_hidden=<script>,xyz");
    expect(p).toEqual(DEFAULT_PREFS);
  });
});

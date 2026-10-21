import { describe, expect, it } from "vitest";
import { locationHref, resultHref, searchErrorKey } from "../search";

describe("search hrefs", () => {
  it("opens folders and shows files in their folder", () => {
    expect(resultHref({ id: "d1", space: "personal", parent_id: null, is_dir: true })).toBe("/files/d1");
    expect(resultHref({ id: "f1", space: "personal", parent_id: "d1", is_dir: false })).toBe("/files/d1?select=f1");
    expect(resultHref({ id: "f2", space: "shared", parent_id: null, is_dir: false })).toBe("/shared?select=f2");
  });

  it("escapes ids", () => {
    expect(locationHref({ id: "a&b", space: "shared", parent_id: "p/q" })).toBe("/shared/p%2Fq?select=a%26b");
  });
});

describe("searchErrorKey", () => {
  it("maps API codes", () => {
    expect(searchErrorKey("empty_query")).toBeNull();
    expect(searchErrorKey("query_too_long")).toBe("search.tooLong");
    expect(searchErrorKey("bad_limit")).toBe("search.invalid");
  });
});

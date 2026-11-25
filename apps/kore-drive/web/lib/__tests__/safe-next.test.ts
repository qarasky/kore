import { describe, expect, it } from "vitest";
import { DEFAULT_LANDING, safeNext } from "../safe-next";

describe("safeNext()", () => {
  it.each([
    ["/files", "/files"],
    ["/files/abc123", "/files/abc123"],
    ["/files/abc?sort=name#top", "/files/abc?sort=name#top"],
    ["/shared/%D0%9F%D0%B0%D0%BF%D0%BA%D0%B0", "/shared/%D0%9F%D0%B0%D0%BF%D0%BA%D0%B0"],
  ])("keeps same-origin relative path %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["files"],
    ["//evil.com"],
    ["//evil.com/files"],
    ["/\\evil.com"],
    ["\\\\evil.com"],
    ["/files\\..\\..\\evil"],
    ["https://evil.com"],
    ["http://127.0.0.1:13000/files"],
    ["javascript:alert(1)"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    [" /files"],
    ["/login"],
    ["/login?next=/files"],
  ])("rejects %j", (input) => {
    expect(safeNext(input)).toBe(DEFAULT_LANDING);
  });

  it("uses the first value when given an array (repeated query param)", () => {
    expect(safeNext(["/files/a", "//evil.com"])).toBe("/files/a");
    expect(safeNext(["//evil.com", "/files/a"])).toBe(DEFAULT_LANDING);
  });

  it("lands on /files by default", () => {
    expect(DEFAULT_LANDING).toBe("/files");
  });
});

import { describe, expect, it } from "vitest";
import { formatBytes } from "../format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [4 * 1024, "4 KB"],
    [10 * 1024 - 1, "10 KB"],
    [2.1 * 1024 * 1024, "2.1 MB"],
    [380 * 1024 * 1024, "380 MB"],
    [1024 * 1024 - 1, "1 MB"], // 1023.999 KB rounds up a unit, not "1024 KB"
    [5 * 1024 ** 3, "5 GB"],
    [1.25 * 1024 ** 4, "1.3 TB"],
  ])("%d -> %s", (n, want) => {
    expect(formatBytes(n, "en")).toBe(want);
  });

  it("treats negative and non-finite input as zero", () => {
    expect(formatBytes(-5, "en")).toBe("0 B");
    expect(formatBytes(Number.NaN, "en")).toBe("0 B");
  });
});

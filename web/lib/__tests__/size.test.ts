import { describe, expect, it } from "vitest";
import { formatBytes } from "../format";
import { FILE_SIZE_UNITS, isSizeUnit, parseSize, QUOTA_UNITS, SIZE_UNITS, splitSize } from "../size";

const GiB = 1024 ** 3;
const TiB = 1024 ** 4;

describe("parseSize", () => {
  it("uses binary units", () => {
    expect(SIZE_UNITS.GB).toBe(GiB);
    expect(parseSize("50", "GB")).toBe(50 * GiB);
    expect(parseSize("1", "TB")).toBe(TiB);
    expect(parseSize("2", "MB")).toBe(2 * 1024 ** 2);
  });

  it("accepts decimals, a comma, a leading dot and spaces", () => {
    expect(parseSize("1.5", "TB")).toBe(1.5 * TiB);
    expect(parseSize("0,5", "GB")).toBe(GiB / 2);
    expect(parseSize(".25", "GB")).toBe(GiB / 4);
    expect(parseSize(" 3 ", "GB")).toBe(3 * GiB);
    expect(parseSize("3.", "GB")).toBe(3 * GiB);
    expect(parseSize("0", "GB")).toBe(0);
  });

  it("rounds to whole bytes", () => {
    expect(parseSize("0.1", "GB")).toBe(Math.round(0.1 * GiB));
    expect(Number.isInteger(parseSize("0.333", "TB"))).toBe(true);
  });

  it("rejects blank, negative, malformed and unsafe values", () => {
    for (const bad of ["", " ", "-1", "1e3", "abc", "1.2.3", "1 GB", "+5", "Infinity", "NaN"]) {
      expect(parseSize(bad, "GB"), bad).toBeNull();
    }
    expect(parseSize("99999999", "TB")).toBeNull();
  });
});

describe("splitSize", () => {
  it("picks the largest unit with a value of at least 1", () => {
    expect(splitSize(50 * GiB)).toEqual({ value: "50", unit: "GB" });
    expect(splitSize(1.5 * TiB)).toEqual({ value: "1.5", unit: "TB" });
    expect(splitSize(1023 * GiB)).toEqual({ value: "1023", unit: "GB" });
    expect(splitSize(TiB)).toEqual({ value: "1", unit: "TB" });
  });

  it("falls back to the smallest unit for small values", () => {
    expect(splitSize(0)).toEqual({ value: "0", unit: "GB" });
    expect(splitSize(GiB / 2)).toEqual({ value: "0.5", unit: "GB" });
    expect(splitSize(100, FILE_SIZE_UNITS)).toEqual({ value: "0", unit: "MB" });
    expect(splitSize(512 * 1024 ** 2, FILE_SIZE_UNITS)).toEqual({ value: "512", unit: "MB" });
  });

  it("rounds to two decimals without grouping", () => {
    expect(splitSize(GiB / 3).value).toBe("0.33");
    expect(splitSize(12345 * GiB, ["GB"]).value).toBe("12345");
  });

  it("accepts units in any order", () => {
    expect(splitSize(2 * TiB, ["TB", "GB"])).toEqual({ value: "2", unit: "TB" });
  });

  it("round-trips exact values", () => {
    for (const bytes of [0, GiB, 50 * GiB, 1.5 * TiB, 3 * TiB]) {
      const { value, unit } = splitSize(bytes, QUOTA_UNITS);
      expect(parseSize(value, unit)).toBe(bytes);
    }
  });

  it("labels sizes the way the storage meter does", () => {
    for (const bytes of [50 * GiB, 2 * TiB, 512 * 1024 ** 2]) {
      const { value, unit } = splitSize(bytes, FILE_SIZE_UNITS);
      expect(formatBytes(bytes, "en")).toBe(`${value} ${unit}`);
    }
  });
});

describe("isSizeUnit", () => {
  it("knows the units", () => {
    expect(isSizeUnit("GB")).toBe(true);
    expect(isSizeUnit("GiB")).toBe(false);
    expect(isSizeUnit("toString")).toBe(false);
  });
});

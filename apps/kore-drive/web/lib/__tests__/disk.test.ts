import { describe, expect, it } from "vitest";
import { diskLevel, diskView, type DiskInfo } from "../disk";

const GB = 1024 ** 3;
const base: DiskInfo = {
  total_bytes: 1000 * GB,
  used_bytes: 500 * GB,
  free_bytes: 450 * GB,
  kore_used_bytes: 200 * GB,
  quota_allocated_bytes: 150 * GB,
  fs_path_label: "/data (/dev/md0, ext4)",
};

describe("diskLevel", () => {
  it.each([
    [0, "ok"],
    [84.9, "ok"],
    [85, "warn"],
    [94.9, "warn"],
    [95, "critical"],
    [100, "critical"],
  ] as const)("%s%% is %s", (pct, level) => {
    expect(diskLevel(pct)).toBe(level);
  });
});

describe("diskView", () => {
  it("splits used into Kore and other data; percent as df shows it", () => {
    const v = diskView(base);
    expect(v.kore).toBe(200 * GB);
    expect(v.other).toBe(300 * GB);
    expect(v.reserved).toBe(50 * GB);
    // df's Use%: used / (used + available).
    expect(v.percentUsed).toBeCloseTo((500 / 950) * 100, 5);
    expect(v.segments.kore + v.segments.other + v.segments.free).toBeCloseTo(100, 5);
    expect(v.level).toBe("ok");
    expect(v.overAllocated).toBe(false);
  });

  it("clamps Kore to what the disk reports as used", () => {
    const v = diskView({ ...base, kore_used_bytes: 900 * GB });
    expect(v.kore).toBe(500 * GB);
    expect(v.other).toBe(0);
  });

  it("flags quota still to be consumed beyond the free space (Kore's use is already on disk)", () => {
    // base: Kore uses 200 GB, 450 GB free.
    expect(diskView({ ...base, quota_allocated_bytes: 651 * GB }).overAllocated).toBe(true);
    expect(diskView({ ...base, quota_allocated_bytes: 650 * GB }).overAllocated).toBe(false);
    expect(diskView({ ...base, quota_allocated_bytes: 451 * GB }).overAllocated).toBe(false);
    // Users over their quota leave nothing still to consume.
    expect(diskView({ ...base, quota_allocated_bytes: 100 * GB }).overAllocated).toBe(false);
  });

  it("the office example: 916 GB disk, Kore uses 600 GB, 316 GB free", () => {
    const office = { ...base, total_bytes: 916 * GB, used_bytes: 600 * GB, free_bytes: 316 * GB, kore_used_bytes: 600 * GB };
    expect(diskView({ ...office, quota_allocated_bytes: 800 * GB }).overAllocated).toBe(false);
    expect(diskView({ ...office, quota_allocated_bytes: 1100 * GB }).overAllocated).toBe(true);
  });

  it("levels follow the percent used", () => {
    expect(diskView({ ...base, used_bytes: 900 * GB, free_bytes: 40 * GB }).level).toBe("critical");
    expect(diskView({ ...base, used_bytes: 850 * GB, free_bytes: 100 * GB }).level).toBe("warn");
  });

  it("survives an empty or nonsensical report", () => {
    const v = diskView({ ...base, total_bytes: 0, used_bytes: 0, free_bytes: 0, kore_used_bytes: 0 });
    expect(v.percentUsed).toBe(0);
    expect(v.segments).toEqual({ kore: 0, other: 0, free: 0 });
    expect(v.reserved).toBe(0);
  });
});

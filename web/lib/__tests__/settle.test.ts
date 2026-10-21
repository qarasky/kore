import { describe, expect, it } from "vitest";
import { settleLimited } from "../settle";

describe("settleLimited", () => {
  it("keeps input order, captures rejections and caps concurrency", async () => {
    let active = 0;
    let peak = 0;
    const results = await settleLimited([5, 1, 4, 2, 3, 0, 6], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      if (n === 4) throw new Error("four");
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : (r.reason as Error).message))).toEqual([
      50, 10, "four", 20, 30, 0, 60,
    ]);
  });

  it("handles an empty list", async () => {
    await expect(settleLimited([], 4, async () => 1)).resolves.toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { duration, ease, pushDirection, reducedMotionFor, spring, staggerDelay, viewEnter } from "@/lib/motion";

describe("the motion scale (docs/superpowers/specs/2026-11-02-web-motion-design.md)", () => {
  it("keeps every duration within the 100-250 ms band the references allow, entering slower than leaving", () => {
    for (const d of Object.values(duration).flatMap((v) => (typeof v === "number" ? [v] : [v.in, v.out]))) {
      expect(d).toBeGreaterThanOrEqual(0.1);
      expect(d).toBeLessThanOrEqual(0.25);
    }
    expect(duration.dialog.in).toBeGreaterThan(duration.dialog.out);
    expect(duration.drawer.in).toBeGreaterThan(duration.drawer.out);
    expect(duration.enter).toBeGreaterThan(duration.exit);
    expect(duration.feedback).toBeLessThanOrEqual(0.1); // NN/g: simple feedback ~100 ms
  });

  it("uses the Material standard curve to enter and its accelerate curve to leave", () => {
    expect(ease.standard).toEqual([0.2, 0, 0, 1]);
    expect(ease.exit).toEqual([0.3, 0, 0.8, 0.15]);
  });

  it("never lets a spring overshoot (critically damped: damping >= 2*sqrt(stiffness*mass))", () => {
    expect(spring.settle.damping).toBeGreaterThanOrEqual(2 * Math.sqrt(spring.settle.stiffness * (spring.settle.mass ?? 1)) - 0.5);
  });
});

describe("staggerDelay", () => {
  it("is zero for a single item and steps 12 ms per item", () => {
    expect(staggerDelay(0, 1)).toBe(0);
    expect(staggerDelay(0, 20)).toBe(0);
    expect(staggerDelay(3, 20)).toBeCloseTo(0.036);
  });
  it("is capped at 120 ms however many events a day has", () => {
    expect(staggerDelay(40, 100)).toBe(0.12);
    expect(staggerDelay(10_000, 20_000)).toBe(0.12);
  });
});

describe("pushDirection (which way time moved)", () => {
  const w = (day: string, view = "week") => ({ view, day });
  it("is +1 going later, -1 going earlier, 0 when nothing in time changed", () => {
    expect(pushDirection(w("2026-11-02"), w("2026-11-09"))).toBe(1);
    expect(pushDirection(w("2026-11-09"), w("2026-11-02"))).toBe(-1);
    expect(pushDirection(w("2026-11-02"), w("2026-11-02"))).toBe(0);
  });
  it("is 0 on the first load and when the view itself changes (a cross-fade, not a push)", () => {
    expect(pushDirection(null, w("2026-11-02"))).toBe(0);
    expect(pushDirection(w("2026-11-02", "week"), w("2026-11-09", "month"))).toBe(0);
  });
});

describe("viewEnter", () => {
  it("pushes in from the side time came from, and only fades when there is no direction", () => {
    expect(viewEnter(1).initial).toEqual({ opacity: 0, x: 20 });
    expect(viewEnter(-1).initial).toEqual({ opacity: 0, x: -20 });
    expect(viewEnter(0).initial).toEqual({ opacity: 0 });
    expect(viewEnter(1).animate).toEqual({ opacity: 1, x: 0 });
  });
});

describe("reducedMotionFor (the Settings choice -> MotionConfig)", () => {
  it("follows the system by default and lets the person force either way", () => {
    expect(reducedMotionFor("system")).toBe("user");
    expect(reducedMotionFor("reduce")).toBe("always");
    expect(reducedMotionFor("full")).toBe("never");
  });
});

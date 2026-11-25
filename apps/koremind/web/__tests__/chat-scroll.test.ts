import { expect, test } from "bun:test";
import { FOLLOW_SLOP, followStep, nextFollowing } from "../lib/chat-scroll";

test("scrolling up stops following, even a little", () => {
  expect(nextFollowing(true, 10, true)).toBe(false);
  expect(nextFollowing(true, 400, true)).toBe(false);
});

test("reaching the bottom follows again", () => {
  expect(nextFollowing(false, 0, false)).toBe(true);
  expect(nextFollowing(false, FOLLOW_SLOP, false)).toBe(true);
  // Content shrinking clamps the scroll upwards, but the list is still at the bottom.
  expect(nextFollowing(true, 0, true)).toBe(true);
});

test("away from the bottom the state is kept", () => {
  expect(nextFollowing(false, 500, false)).toBe(false);
  expect(nextFollowing(true, 500, false)).toBe(true);
});

test("follow step eases instead of jumping", () => {
  const step = followStep(200, 800, 16);
  expect(step).toBeGreaterThan(1);
  expect(step).toBeLessThan(200);
});

test("follow step never overshoots and always makes progress", () => {
  expect(followStep(0, 800, 16)).toBe(0);
  expect(followStep(-5, 800, 16)).toBe(0);
  expect(followStep(0.4, 800, 16)).toBe(0.4);
  expect(followStep(3, 800, 0)).toBe(1);
  expect(followStep(50, 800, 10_000)).toBeLessThanOrEqual(50);
});

test("a gap of more than two screens is jumped at once", () => {
  expect(followStep(5000, 800, 16)).toBe(5000);
});

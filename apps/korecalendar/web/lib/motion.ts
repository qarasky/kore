/**
 * The app's own motion: springs and the small pure helpers the animated
 * components share. Durations and easing come from kore-ui (`koreDuration`,
 * `koreEase`). Pure: no React.
 */
import type { MotionPref } from "./prefs";

/** Critically damped: things settle, they do not bounce. */
export const spring = {
  settle: { type: "spring" as const, stiffness: 500, damping: 45, mass: 1 },
};

export const STAGGER_STEP = 0.012;
export const STAGGER_CAP = 0.12;

/** Delay (seconds) for item `index` of `count` appearing together: 12 ms apart, 120 ms at most in total. */
export function staggerDelay(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(index * STAGGER_STEP, STAGGER_CAP);
}

/**
 * Which way time moved between two screens: 1 later, -1 earlier, 0 for the first
 * load, an unchanged day, or a change of view (that is a cross-fade, not a push).
 * Days are YYYY-MM-DD, so string order is time order.
 */
export function pushDirection(prev: { view: string; day: string } | null, next: { view: string; day: string }): -1 | 0 | 1 {
  if (!prev || prev.view !== next.view || prev.day === next.day) return 0;
  return next.day > prev.day ? 1 : -1;
}

/**
 * The identity a block keeps while it moves between day columns, so Motion can
 * glide it across. A series occurrence is its series plus its original start
 * (stable when moved); a single event is just itself (its key is its start,
 * which a move changes).
 */
export function layoutKey(occ: { event_id: string; key: string; is_recurring: boolean }): string {
  return occ.is_recurring ? `${occ.event_id}|${occ.key}` : occ.event_id;
}

/** Initial/animate states for a view's content entering. Distance is small: this happens all day long. */
export function viewEnter(direction: -1 | 0 | 1): {
  initial: { opacity: number; x?: number };
  animate: { opacity: number; x?: number };
} {
  if (direction === 0) return { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return { initial: { opacity: 0, x: direction * 20 }, animate: { opacity: 1, x: 0 } };
}

/** What Motion's `MotionConfig` should do for each choice in Settings. */
export function reducedMotionFor(pref: MotionPref): "user" | "always" | "never" {
  return pref === "reduce" ? "always" : pref === "full" ? "never" : "user";
}

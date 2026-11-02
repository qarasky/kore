/**
 * The motion scale: durations, easing, springs and the small pure helpers the
 * animated components share. Every number here is argued for in
 * docs/superpowers/specs/2026-11-02-web-motion-design.md. Pure: no React.
 */
import type { MotionPref } from "./prefs";

/** Seconds. Nothing is longer than 250 ms; entering is slower than leaving. */
export const duration = {
  /** Hover, press, checkbox, switch, colour: "simple feedback ~100 ms". */
  feedback: 0.1,
  /** Popovers, menus, an event block appearing. */
  enter: 0.16,
  exit: 0.1,
  /** A period or view change. */
  view: 0.2,
  dialog: { in: 0.22, out: 0.14 },
  drawer: { in: 0.25, out: 0.18 },
} as const;

/** Material 3 standard (fast start, long gentle settle) to enter; accelerate to leave. */
export const ease = {
  standard: [0.2, 0, 0, 1] as [number, number, number, number],
  exit: [0.3, 0, 0.8, 0.15] as [number, number, number, number],
};

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

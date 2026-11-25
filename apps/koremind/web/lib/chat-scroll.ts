// How the message list follows a streaming answer. Kept 1:1 with android ChatScroll.kt.

/** Within this many px (dp on Android) of the bottom, the list counts as "at the bottom" and follows new text again. */
export const FOLLOW_SLOP = 32;
/** Time constant of the easing: each frame closes the gap by 1 - e^(-dt / FOLLOW_TAU_MS). */
export const FOLLOW_TAU_MS = 90;

/**
 * Whether the list should keep following new text after a scroll.
 * Any upward move by the reader stops following, so they can read earlier text in peace;
 * coming back down to the bottom starts it again.
 */
export function nextFollowing(following: boolean, distanceToBottom: number, movedUp: boolean): boolean {
  if (distanceToBottom <= 1) return true; // at the bottom (also when shrinking content clamps the scroll)
  if (movedUp) return false;
  if (distanceToBottom <= FOLLOW_SLOP) return true;
  return following;
}

/**
 * How far to scroll down this frame to ease towards the bottom.
 * A gap bigger than two screens (opening a chat, a huge block arriving) is jumped at once.
 */
export function followStep(distanceToBottom: number, viewport: number, dtMs: number): number {
  if (distanceToBottom <= 0) return 0;
  if (distanceToBottom < 1 || distanceToBottom > viewport * 2) return distanceToBottom;
  const dt = Math.min(Math.max(dtMs, 0), 64);
  const eased = distanceToBottom * (1 - Math.exp(-dt / FOLLOW_TAU_MS));
  return Math.min(distanceToBottom, Math.max(1, eased));
}

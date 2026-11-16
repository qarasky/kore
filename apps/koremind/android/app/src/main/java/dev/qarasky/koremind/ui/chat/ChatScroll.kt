package dev.qarasky.koremind.ui.chat

import kotlin.math.exp

// How the message list follows a streaming answer. Kept 1:1 with web lib/chat-scroll.ts.

/** Within this many dp (px on web) of the bottom, the list counts as "at the bottom" and follows new text again. */
const val FOLLOW_SLOP = 32f
/** Time constant of the easing: each frame closes the gap by 1 - e^(-dt / FOLLOW_TAU_MS). */
const val FOLLOW_TAU_MS = 90f

/**
 * Whether the list should keep following new text after a scroll.
 * Any upward move by the reader stops following, so they can read earlier text in peace;
 * coming back down to the bottom starts it again.
 */
fun nextFollowing(following: Boolean, distanceToBottom: Float, movedUp: Boolean): Boolean {
    if (distanceToBottom <= 1f) return true // at the bottom (also when shrinking content clamps the scroll)
    if (movedUp) return false
    if (distanceToBottom <= FOLLOW_SLOP) return true
    return following
}

/**
 * How far to scroll down this frame to ease towards the bottom.
 * A gap bigger than two screens (opening a chat, a huge block arriving) is jumped at once.
 */
fun followStep(distanceToBottom: Float, viewport: Float, dtMs: Float): Float {
    if (distanceToBottom <= 0f) return 0f
    if (distanceToBottom < 1f || distanceToBottom > viewport * 2) return distanceToBottom
    val dt = dtMs.coerceIn(0f, 64f)
    val eased = distanceToBottom * (1 - exp(-dt / FOLLOW_TAU_MS))
    return minOf(distanceToBottom, maxOf(1f, eased))
}

package dev.qarasky.koremind

import dev.qarasky.koremind.ui.chat.FOLLOW_SLOP
import dev.qarasky.koremind.ui.chat.followStep
import dev.qarasky.koremind.ui.chat.nextFollowing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatScrollTest {
    @Test fun `scrolling up stops following, even a little`() {
        assertFalse(nextFollowing(true, 10f, true))
        assertFalse(nextFollowing(true, 400f, true))
    }

    @Test fun `reaching the bottom follows again`() {
        assertTrue(nextFollowing(false, 0f, false))
        assertTrue(nextFollowing(false, FOLLOW_SLOP, false))
        // Content shrinking clamps the scroll upwards, but the list is still at the bottom.
        assertTrue(nextFollowing(true, 0f, true))
    }

    @Test fun `away from the bottom the state is kept`() {
        assertFalse(nextFollowing(false, 500f, false))
        assertTrue(nextFollowing(true, 500f, false))
    }

    @Test fun `follow step eases instead of jumping`() {
        val step = followStep(200f, 800f, 16f)
        assertTrue(step > 1f)
        assertTrue(step < 200f)
    }

    @Test fun `follow step never overshoots and always makes progress`() {
        assertEquals(0f, followStep(0f, 800f, 16f), 0f)
        assertEquals(0f, followStep(-5f, 800f, 16f), 0f)
        assertEquals(0.4f, followStep(0.4f, 800f, 16f), 0f)
        assertEquals(1f, followStep(3f, 800f, 0f), 0f)
        assertTrue(followStep(50f, 800f, 10_000f) <= 50f)
    }

    @Test fun `a gap of more than two screens is jumped at once`() {
        assertEquals(5000f, followStep(5000f, 800f, 16f), 0f)
    }
}

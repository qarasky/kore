package dev.qarasky.koremind

import dev.qarasky.koremind.ui.model.effortAt
import dev.qarasky.koremind.ui.model.effortIndex
import dev.qarasky.koremind.ui.model.effortStops
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EffortTest {
    @Test fun `effortStops puts Default first, then the model's levels`() {
        assertEquals(listOf(null, "low", "high"), effortStops(listOf("low", "high")))
        assertEquals(listOf<String?>(null), effortStops(emptyList()))
    }

    @Test fun `effortIndex finds the level and falls back to Default for one the model doesn't offer`() {
        assertEquals(2, effortIndex(listOf("low", "high"), "high"))
        assertEquals(0, effortIndex(listOf("low", "high"), "xhigh"))
        assertEquals(0, effortIndex(listOf("low"), null))
    }

    @Test fun `effortAt clamps the index to the stops`() {
        assertEquals("high", effortAt(listOf("low", "high"), 9))
        assertNull(effortAt(listOf("low"), -3))
        assertEquals("low", effortAt(listOf("low", "high"), 1))
    }
}

package dev.qarasky.koremind

import dev.qarasky.koremind.ui.chat.fitColumns
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TableLayoutTest {
    @Test fun `a narrow table grows to fill the width in proportion to its columns`() {
        val w = fitColumns(listOf(100, 300), 800)
        assertEquals(800, w.sum())
        assertEquals(listOf(200, 600), w)
    }

    @Test fun `a wide table shrinks to fit the screen instead of scrolling when every column can keep the minimum`() {
        val w = fitColumns(listOf(220, 220, 220), 330)
        assertEquals(listOf(110, 110, 110), w)
    }

    @Test fun `a short column keeps the minimum and the others share what is left`() {
        val w = fitColumns(listOf(220, 64, 220), 330)
        assertEquals(88, w[1])
        assertEquals(330, w.sum())
        assertEquals(w[0], w[2])
    }

    @Test fun `when even the minimum does not fit the table keeps the minimum and scrolls`() {
        val w = fitColumns(listOf(220, 220, 220, 220), 300)
        assertEquals(listOf(88, 88, 88, 88), w)
        assertTrue(w.sum() > 300)
    }

    @Test fun `no columns, no widths`() {
        assertEquals(emptyList<Int>(), fitColumns(emptyList(), 300))
    }
}

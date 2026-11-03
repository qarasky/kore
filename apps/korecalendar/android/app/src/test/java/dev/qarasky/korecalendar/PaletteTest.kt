package dev.qarasky.korecalendar

import androidx.compose.ui.graphics.toArgb
import dev.qarasky.korecalendar.ui.theme.Palette
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The app's colours are the web app's tokens; this keeps them from drifting apart. */
class PaletteTest {
    private val css = File("../../web/app/globals.css").readText()

    private fun token(name: String): Int {
        val m = Regex("--color-$name:\\s*#([0-9a-fA-F]{6});").find(css)
        assertTrue("web/app/globals.css has no --color-$name", m != null)
        return m!!.groupValues[1].toInt(16)
    }

    private fun Int.rgb() = this and 0xFFFFFF

    @Test
    fun matchesWebTokens() {
        assertEquals(token("bg"), Palette.bg.toArgb().rgb())
        assertEquals(token("surface"), Palette.surface.toArgb().rgb())
        assertEquals(token("raised"), Palette.raised.toArgb().rgb())
        assertEquals(token("border"), Palette.border.toArgb().rgb())
        assertEquals(token("border-strong"), Palette.borderStrong.toArgb().rgb())
        assertEquals(token("text"), Palette.text.toArgb().rgb())
        assertEquals(token("muted"), Palette.muted.toArgb().rgb())
        assertEquals(token("accent"), Palette.accent.toArgb().rgb())
        assertEquals(token("danger"), Palette.danger.toArgb().rgb())
        assertEquals(token("warning"), Palette.warning.toArgb().rgb())
    }

    @Test
    fun cssHasAllTokens() {
        for (n in listOf("bg", "surface", "raised", "border", "border-strong", "text", "muted", "accent", "danger", "warning")) token(n)
    }
}

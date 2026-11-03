package dev.qarasky.korecalendar

import androidx.compose.ui.graphics.toArgb
import dev.qarasky.korecalendar.ui.theme.Palette
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The app's colours are the Kore design tokens of kore-ui (the web app imports its theme.css); this keeps
 * them from drifting apart. The theme comes from $KORE_UI_THEME (CI downloads the version web/package.json
 * pins) or from web/node_modules after `npm ci` in web/. Without either it is skipped locally and fails on CI.
 */
class PaletteTest {
    private val css: String by lazy {
        val candidates = listOfNotNull(System.getenv("KORE_UI_THEME"), "../../web/node_modules/@qarasky/kore-ui/theme.css").map(::File)
        val file = candidates.firstOrNull { it.isFile }
        if (System.getenv("CI") != null) assertTrue("kore-ui theme.css not found (set KORE_UI_THEME)", file != null)
        assumeTrue("kore-ui theme.css not found: run npm ci in web/ or set KORE_UI_THEME", file != null)
        file!!.readText()
    }

    private fun token(name: String): Int {
        val m = Regex("--color-$name:\\s*#([0-9a-fA-F]{6});").find(css)
        assertTrue("kore-ui theme.css has no --color-$name", m != null)
        return m!!.groupValues[1].toInt(16)
    }

    private fun Int.rgb() = this and 0xFFFFFF

    @Test
    fun matchesKoreUiTokens() {
        assertEquals(token("bg"), Palette.bg.toArgb().rgb())
        assertEquals(token("surface"), Palette.surface.toArgb().rgb())
        assertEquals(token("raised"), Palette.raised.toArgb().rgb())
        assertEquals(token("border"), Palette.border.toArgb().rgb())
        assertEquals(token("border-strong"), Palette.borderStrong.toArgb().rgb())
        assertEquals(token("text"), Palette.text.toArgb().rgb())
        assertEquals(token("muted"), Palette.muted.toArgb().rgb())
        assertEquals(token("accent"), Palette.accent.toArgb().rgb())
        assertEquals(token("accent-hover"), Palette.accentHover.toArgb().rgb())
        assertEquals(token("danger"), Palette.danger.toArgb().rgb())
        assertEquals(token("warning"), Palette.warning.toArgb().rgb())
    }
}

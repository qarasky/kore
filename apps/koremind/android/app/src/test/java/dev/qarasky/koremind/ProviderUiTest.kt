package dev.qarasky.koremind

import dev.qarasky.koremind.data.ModelInfo
import dev.qarasky.koremind.data.ProviderInfo
import dev.qarasky.koremind.data.Settings
import dev.qarasky.koremind.ui.Choice
import dev.qarasky.koremind.ui.model.defaultChoice
import dev.qarasky.koremind.ui.model.filterModels
import dev.qarasky.koremind.ui.model.initialRail
import dev.qarasky.koremind.ui.model.isChoiceAllowed
import dev.qarasky.koremind.ui.model.providerIconRes
import dev.qarasky.koremind.ui.model.railAlpha
import dev.qarasky.koremind.ui.model.railNoticeRes
import dev.qarasky.koremind.ui.settings.freeOnly
import dev.qarasky.koremind.ui.settings.providerEnabled
import dev.qarasky.koremind.ui.settings.providerPrefsChanged
import dev.qarasky.koremind.ui.settings.toggleInList
import dev.qarasky.koremind.ui.settings.withFreeOnly
import dev.qarasky.koremind.ui.settings.withProviderEnabled
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderUiTest {
    private fun m(id: String, free: Boolean = false, default: Boolean = false) = ModelInfo(id, id.uppercase(), false, emptyList(), default, free)
    private val opencode = ProviderInfo("opencode", "OpenCode", false, listOf(m("big", free = true, default = true)), "ready")
    private val codex = ProviderInfo("openai", "Codex", false, emptyList(), "needs_connection")
    private val router = ProviderInfo("openrouter", "OpenRouter", true, listOf(m("a/free:free", free = true), m("b/paid")), "disabled")
    private val all = listOf(opencode, codex, router)

    @Test fun `each known provider has a real logo and unknown ones fall back to the initial`() {
        assertEquals(R.drawable.ic_provider_opencode, providerIconRes("opencode"))
        assertEquals(R.drawable.ic_provider_openai, providerIconRes("openai"))
        assertEquals(R.drawable.ic_provider_openrouter, providerIconRes("openrouter"))
        assertNull(providerIconRes("something-else"))
    }

    @Test fun `only ready providers are full strength and the others explain why`() {
        assertEquals(1f, railAlpha(opencode), 0f)
        assertEquals(0.4f, railAlpha(codex), 0f)
        assertEquals(0.4f, railAlpha(router), 0f)
        assertNull(railNoticeRes(opencode))
        assertEquals(R.string.provider_needs_connection, railNoticeRes(codex))
        assertEquals(R.string.provider_disabled, railNoticeRes(router))
    }

    @Test fun `favorites and provider rails never list models of a provider that is not ready`() {
        val favs = setOf("opencode/big", "openrouter/b/paid")
        assertEquals(listOf("opencode/big"), filterModels(all, favs, "favorites", "").map { it.key })
        assertEquals(emptyList<String>(), filterModels(all, favs, "openrouter", "").map { it.key })
    }

    @Test fun `the picker opens on favorites when a ready provider has one, else on the current or first ready provider`() {
        assertEquals("favorites", initialRail(all, setOf("opencode/big"), null))
        assertEquals("opencode", initialRail(all, setOf("openrouter/b/paid"), Choice("opencode", "big")))
        assertEquals("opencode", initialRail(all, emptySet(), Choice("openai", "x")))
        assertEquals("favorites", initialRail(emptyList(), emptySet(), null))
    }

    @Test fun `a saved choice is allowed only while its provider is ready and the model still listed`() {
        assertTrue(isChoiceAllowed(all, "opencode", "big"))
        assertFalse(isChoiceAllowed(all, "opencode", "gone"))
        assertFalse(isChoiceAllowed(all, "openrouter", "a/free:free"))
        assertFalse(isChoiceAllowed(all, "openai", "x"))
    }

    @Test fun `the fallback is the default model of the first ready provider`() {
        assertEquals("opencode" to "big", defaultChoice(all))
        assertNull(defaultChoice(listOf(codex, router)))
        val p = ProviderInfo("opencode", "OpenCode", true, listOf(m("x"), m("y", default = true)))
        assertEquals("opencode" to "y", defaultChoice(listOf(p)))
    }

    // ---- settings helpers ----------------------------------------------------------------------
    @Test fun `toggleInList adds once and removes cleanly`() {
        assertEquals(listOf("a", "b"), toggleInList(listOf("a"), "b", true))
        assertEquals(listOf("a", "b"), toggleInList(listOf("a", "b"), "b", true))
        assertEquals(listOf("a"), toggleInList(listOf("a", "b"), "b", false))
        assertEquals(listOf("a"), toggleInList(listOf("a"), "z", false))
    }

    @Test fun `a provider is enabled unless listed and free-only only when listed`() {
        val s = Settings()
        assertTrue(providerEnabled(s, "openrouter"))
        assertFalse(freeOnly(s, "openrouter"))
        val off = withProviderEnabled(s, "openrouter", false)
        assertFalse(providerEnabled(off, "openrouter"))
        assertTrue(providerEnabled(withProviderEnabled(off, "openrouter", true), "openrouter"))
        val fo = withFreeOnly(s, "opencode", true)
        assertTrue(freeOnly(fo, "opencode"))
        assertFalse(freeOnly(withFreeOnly(fo, "opencode", false), "opencode"))
        assertEquals("", fo.displayName)
    }

    @Test fun `only provider preferences trigger a picker refresh`() {
        val s = Settings()
        assertFalse(providerPrefsChanged(s, s.copy(displayName = "Sky", tone = "x", about = "y", memoryEnabled = false)))
        assertTrue(providerPrefsChanged(s, withProviderEnabled(s, "openai", false)))
        assertTrue(providerPrefsChanged(s, withFreeOnly(s, "opencode", true)))
    }
}

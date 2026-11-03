package dev.qarasky.koremind

import dev.qarasky.koremind.ui.settings.ProviderState
import dev.qarasky.koremind.ui.settings.SECTIONS
import dev.qarasky.koremind.ui.settings.TONE_PRESETS
import dev.qarasky.koremind.ui.settings.activePreset
import dev.qarasky.koremind.ui.settings.providerStatus
import dev.qarasky.koremind.ui.settings.sectionFromRoute
import dev.qarasky.koremind.ui.settings.togglePreset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SettingsModelTest {
    @Test fun `sections are five and ordered models providers personalization memory account`() {
        assertEquals(listOf("models", "providers", "personalization", "memory", "account"), SECTIONS.map { it.id })
    }

    @Test fun `a preset sets the tone and picking it again clears it`() {
        val p = TONE_PRESETS[0]
        assertEquals(p.tone, togglePreset("", p.id))
        assertEquals(p.id, activePreset(p.tone))
        assertEquals("", togglePreset(p.tone, p.id))
    }

    @Test fun `typed text matches no preset and another preset replaces it`() {
        assertNull(activePreset("talk like a pirate"))
        assertEquals(TONE_PRESETS[1].tone, togglePreset("talk like a pirate", TONE_PRESETS[1].id))
    }

    @Test fun `presets use the same wording as the web app`() {
        assertEquals(listOf("direct", "friendly", "formal", "playful"), TONE_PRESETS.map { it.id })
        assertEquals("Short and direct. No filler.", TONE_PRESETS[0].tone)
        assertEquals("Warm and friendly, like a good friend.", TONE_PRESETS[1].tone)
    }

    @Test fun `provider status explains the state`() {
        assertEquals(ProviderState.Free, providerStatus("opencode", false))
        assertEquals(ProviderState.Off, providerStatus("openai", false))
        assertEquals(ProviderState.On, providerStatus("openrouter", true))
    }

    @Test fun `a settings link opens the right section and falls back to models`() {
        assertEquals("providers", sectionFromRoute("providers").id)
        assertEquals("models", sectionFromRoute("nonsense").id)
        assertEquals("models", sectionFromRoute(null).id)
    }
}

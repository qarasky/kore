package dev.qarasky.zero.ui.settings

import androidx.annotation.StringRes
import dev.qarasky.zero.R

/** Settings stay short: five sections, one visible at a time. Mirrors web/lib/settings-model.ts. */
data class SettingsSection(val id: String, @StringRes val label: Int)

val SECTIONS = listOf(
    SettingsSection("models", R.string.section_models),
    SettingsSection("providers", R.string.section_providers),
    SettingsSection("personalization", R.string.personalization),
    SettingsSection("memory", R.string.memory),
    SettingsSection("account", R.string.account),
)

fun sectionFromRoute(id: String?): SettingsSection = SECTIONS.firstOrNull { it.id == id } ?: SECTIONS.first()

/** Presets are named by outcome, not by parameters. The tone text is what the assistant is told, so it matches the web app. */
data class TonePreset(val id: String, @StringRes val label: Int, val tone: String)

val TONE_PRESETS = listOf(
    TonePreset("direct", R.string.tone_direct, "Short and direct. No filler."),
    TonePreset("friendly", R.string.tone_friendly, "Warm and friendly, like a good friend."),
    TonePreset("formal", R.string.tone_formal, "Formal and precise."),
    TonePreset("playful", R.string.tone_playful, "Playful, with a light sense of humor."),
)

fun activePreset(tone: String): String? = TONE_PRESETS.firstOrNull { it.tone == tone }?.id

fun togglePreset(tone: String, id: String): String {
    val p = TONE_PRESETS.firstOrNull { it.id == id } ?: return tone
    return if (tone == p.tone) "" else p.tone
}

enum class ProviderState { On, Off, Free }

fun providerStatus(id: String, connected: Boolean): ProviderState =
    if (connected) ProviderState.On else if (id == "opencode") ProviderState.Free else ProviderState.Off

const val NAME_MAX = 60
const val TONE_MAX = 200
const val ABOUT_MAX = 600

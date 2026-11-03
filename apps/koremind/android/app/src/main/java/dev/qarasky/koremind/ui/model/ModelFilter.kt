package dev.qarasky.koremind.ui.model

import androidx.annotation.StringRes
import dev.qarasky.koremind.R
import dev.qarasky.koremind.data.Attachment
import dev.qarasky.koremind.data.ModelInfo
import dev.qarasky.koremind.data.ProviderInfo
import dev.qarasky.koremind.ui.Choice

data class PickerRow(val key: String, val providerId: String, val providerName: String, val model: ModelInfo)

/** Rows for the picker. [rail] is "favorites" or a provider id. */
fun filterModels(providers: List<ProviderInfo>, favorites: Set<String>, rail: String, query: String): List<PickerRow> {
    val q = query.trim().lowercase()
    val rows = providers.filter(::isReady).flatMap { p -> p.models.map { PickerRow("${p.id}/${it.id}", p.id, p.name, it) } }
    val inRail = if (rail == "favorites") rows.filter { it.key in favorites } else rows.filter { it.providerId == rail }
    return inRail.filter { q.isEmpty() || it.model.name.lowercase().contains(q) || it.model.id.lowercase().contains(q) }
}

fun thinkingLabel(level: String?): String = level?.replaceFirstChar { it.uppercase() } ?: ""

/** True when a photo is attached but the chosen model can't read photos. */
fun lacksVision(attachments: List<Attachment>, model: ModelInfo?): Boolean =
    model != null && !model.vision && attachments.any { it.mime.startsWith("image/") }

fun isReady(p: ProviderInfo): Boolean = p.status == "ready"

/** Real logos for the providers KoreMind offers. Unknown ids get the initial-letter fallback. */
@androidx.annotation.DrawableRes
fun providerIconRes(id: String): Int? = when (id) {
    "groq" -> R.drawable.ic_provider_groq
    "opencode" -> R.drawable.ic_provider_opencode
    "openai" -> R.drawable.ic_provider_openai
    "openrouter" -> R.drawable.ic_provider_openrouter
    else -> null
}

/** Providers that can't be used right now are dimmed on the rail but still tappable, to explain why. */
fun railAlpha(p: ProviderInfo): Float = if (isReady(p)) 1f else 0.4f

/** The explanation shown instead of model rows for a provider that isn't ready; null when it is. Takes the provider name as its argument. */
@StringRes
fun railNoticeRes(p: ProviderInfo): Int? = when (p.status) {
    "ready" -> null
    "disabled" -> R.string.provider_disabled
    else -> R.string.provider_needs_connection
}

/** Where the picker opens: favorites if a usable one is pinned, else the current provider, else the first ready one. */
fun initialRail(providers: List<ProviderInfo>, favorites: Set<String>, choice: Choice?): String {
    val hasFavorite = providers.filter(::isReady).any { p -> p.models.any { "${p.id}/${it.id}" in favorites } }
    if (hasFavorite) return "favorites"
    choice?.let { c -> providers.firstOrNull { it.id == c.providerId && isReady(it) }?.let { return it.id } }
    return providers.firstOrNull(::isReady)?.id ?: "favorites"
}

fun isChoiceAllowed(providers: List<ProviderInfo>, providerId: String, modelId: String): Boolean =
    providers.any { it.id == providerId && isReady(it) && it.models.any { m -> m.id == modelId } }

/** The model to fall back to: the default of the first ready provider that has models. */
fun defaultChoice(providers: List<ProviderInfo>): Pair<String, String>? {
    val p = providers.firstOrNull { isReady(it) && it.models.isNotEmpty() } ?: return null
    val m = p.models.firstOrNull { it.isDefault } ?: p.models.first()
    return p.id to m.id
}

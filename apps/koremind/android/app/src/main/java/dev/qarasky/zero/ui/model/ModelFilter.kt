package dev.qarasky.zero.ui.model

import dev.qarasky.zero.data.Attachment
import dev.qarasky.zero.data.ModelInfo
import dev.qarasky.zero.data.ProviderInfo

data class PickerRow(val key: String, val providerId: String, val providerName: String, val model: ModelInfo)

/** Rows for the picker. [rail] is "favorites" or a provider id. */
fun filterModels(providers: List<ProviderInfo>, favorites: Set<String>, rail: String, query: String): List<PickerRow> {
    val q = query.trim().lowercase()
    val rows = providers.flatMap { p -> p.models.map { PickerRow("${p.id}/${it.id}", p.id, p.name, it) } }
    val inRail = if (rail == "favorites") rows.filter { it.key in favorites } else rows.filter { it.providerId == rail }
    return inRail.filter { q.isEmpty() || it.model.name.lowercase().contains(q) || it.model.id.lowercase().contains(q) }
}

fun thinkingLabel(level: String?): String = level?.replaceFirstChar { it.uppercase() } ?: ""

/** True when a photo is attached but the chosen model can't read photos. */
fun lacksVision(attachments: List<Attachment>, model: ModelInfo?): Boolean =
    model != null && !model.vision && attachments.any { it.mime.startsWith("image/") }

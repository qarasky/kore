package dev.qarasky.koremind.ui.chat

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Rich "cards" the assistant can put in a message: a fenced block ```card with JSON inside.
 * A port of shared/src/cards.ts: the same limits and rules (shared/fixtures/cards.json is run by both test suites),
 * so a card reads identically on web and Android. Anything unusable is null and shows as a plain code block.
 */
enum class Tone(val id: String) { Neutral("neutral"), Good("good"), Warn("warn"), Bad("bad"), Info("info") }

data class CardStat(val label: String, val value: String, val tone: Tone? = null)
data class CardBar(val label: String, val value: String, val share: Double, val tone: Tone? = null)
data class CardBadge(val text: String, val tone: Tone)

sealed interface CardSection {
    data class Stats(val items: List<CardStat>) : CardSection
    data class Table(val columns: List<String>, val rows: List<List<String>>, val totalRow: Boolean) : CardSection
    data class Bars(val items: List<CardBar>) : CardSection
    data class Note(val text: String) : CardSection
}

data class Card(val title: String?, val subtitle: String?, val badge: CardBadge?, val sections: List<CardSection>)

private const val MAX_SECTIONS = 8
private const val MAX_STATS = 4
private const val MAX_COLUMNS = 6
private const val MAX_ROWS = 40
private const val MAX_BARS = 12
private const val MAX_TEXT = 600
private const val MAX_SHORT = 160

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.arr(): JsonArray? = this as? JsonArray

/** Text from a string or a number; anything else is nothing. */
private fun text(v: JsonElement?, max: Int): String? {
    val p = v as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    val s = if (p.isString) p.content else p.content.toDoubleOrNull()?.takeIf { it.isFinite() }?.let { d -> if (d == Math.floor(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString() }
    val t = s?.trim()
    return if (t.isNullOrEmpty()) null else t.take(max)
}

private fun tone(v: JsonElement?): Tone? {
    val p = v as? JsonPrimitive ?: return null
    return if (p !is JsonNull && p.isString) Tone.entries.firstOrNull { it.id == p.content } else null
}

private fun clamp01(v: JsonElement?): Double {
    val p = v as? JsonPrimitive ?: return 0.0
    if (p is JsonNull) return 0.0
    val n = p.content.toDoubleOrNull() ?: return 0.0
    return if (n.isFinite()) n.coerceIn(0.0, 1.0) else 0.0
}

private fun section(raw: JsonElement): CardSection? {
    val o = raw.obj() ?: return null
    val type = (o["type"] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content
    when (type) {
        "stats" -> {
            val items = (o["items"].arr() ?: emptyList()).mapNotNull { i ->
                val io = i.obj() ?: return@mapNotNull null
                val label = text(io["label"], MAX_SHORT); val value = text(io["value"], 40)
                if (label != null && value != null) CardStat(label, value, tone(io["tone"])) else null
            }.take(MAX_STATS)
            return if (items.isEmpty()) null else CardSection.Stats(items)
        }
        "table" -> {
            val columns = (o["columns"].arr() ?: emptyList()).map { text(it, 60) ?: "" }.take(MAX_COLUMNS)
            if (columns.isEmpty()) return null
            val rows = (o["rows"].arr() ?: emptyList()).mapNotNull { it.arr() }.take(MAX_ROWS)
                .map { r -> columns.indices.map { i -> text(r.getOrNull(i), MAX_SHORT) ?: "" } }
            val total = (o["totalRow"] as? JsonPrimitive)?.let { it !is JsonNull && !it.isString && it.content == "true" } == true
            return CardSection.Table(columns, rows, total)
        }
        "bars" -> {
            val items = (o["items"].arr() ?: emptyList()).mapNotNull { i ->
                val io = i.obj() ?: return@mapNotNull null
                val label = text(io["label"], MAX_SHORT); val value = text(io["value"], 40)
                if (label != null && value != null) CardBar(label, value, clamp01(io["share"]), tone(io["tone"])) else null
            }.take(MAX_BARS)
            return if (items.isEmpty()) null else CardSection.Bars(items)
        }
        "note" -> return text(o["text"], MAX_TEXT)?.let { CardSection.Note(it) }
        else -> return null
    }
}

/** The card in [raw] (the JSON between the fences), normalised, or null when it is not a usable card. */
fun parseCard(raw: String): Card? {
    val v = try { Json.parseToJsonElement(raw) } catch (_: Exception) { return null }
    val o = v.obj() ?: return null
    val title = text(o["title"], MAX_SHORT); val subtitle = text(o["subtitle"], MAX_SHORT)
    val badgeObj = o["badge"].obj()
    val badgeText = badgeObj?.let { text(it["text"], 40) }
    val badge = badgeText?.let { CardBadge(it, tone(badgeObj["tone"]) ?: Tone.Neutral) }
    val sections = (o["sections"].arr() ?: emptyList()).mapNotNull(::section).take(MAX_SECTIONS)
    if (title == null && subtitle == null && badge == null && sections.isEmpty()) return null
    return Card(title, subtitle, badge, sections)
}

private val NUMBER = Regex("""^[~≈+\-−(]?\d[\d.,]*(%|[KMBkmb]|[x×])?([–—-][~≈]?\d[\d.,]*(%|[KMBkmb]|[x×])?)?\)?$""")
private val CURRENCY = Regex("[€$£¥₸₽]")
private val SPACES = Regex("(?U)\\s+")

/** True when every non-empty cell of column [i] is a number, amount, range or dash: those columns are right-aligned. */
fun isNumericColumn(rows: List<List<String>>, i: Int): Boolean {
    val cells = rows.mapNotNull { it.getOrNull(i) }.filter { it.trim().isNotEmpty() }
    if (cells.isEmpty()) return false
    return cells.all { c ->
        val t = c.replace(CURRENCY, "").replace(SPACES, "").trim()
        t.length == 1 && t[0] in "—–-" || NUMBER.matches(t)
    }
}

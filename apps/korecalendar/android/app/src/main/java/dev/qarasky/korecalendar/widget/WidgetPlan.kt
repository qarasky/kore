package dev.qarasky.korecalendar.widget

import dev.qarasky.korecalendar.agenda.AgendaDay
import kotlin.math.floor

// How many rows the widget lists for the room it has. Pure, so it is tested on the JVM.

private const val PADDING_DP = 24f
private const val HEADING_DP = 16f
private const val ROW_DP = 18f
private const val FOOTER_DP = 14f

/**
 * Rows to ask the agenda for at a widget [heightDp] tall: three at the default 110 dp, one more per 36 dp,
 * 1..10. Larger system text ([fontScale], 1.0 normal) makes every line taller, so it counts as less room.
 */
fun rowsFor(heightDp: Float, fontScale: Float = 1f): Int =
    (3 + floor((heightDp / fontScale.coerceAtLeast(1f) - 110f) / 36f).toInt()).coerceIn(1, 10)

/**
 * Drops trailing rows (and headings left empty) until the list fits [heightDp], keeping at least
 * one row. Several day headings use more room than [rowsFor] counted on.
 */
fun fitRows(days: List<AgendaDay>, heightDp: Float, footer: Boolean, fontScale: Float = 1f): List<AgendaDay> {
    var current = days.filter { it.items.isNotEmpty() }
    val scale = fontScale.coerceAtLeast(1f) // text is in sp: it grows with the system font size, the padding does not
    fun cost(d: List<AgendaDay>) = PADDING_DP + scale * (d.size * HEADING_DP + d.sumOf { it.items.size } * ROW_DP + if (footer) FOOTER_DP else 0f)
    while (cost(current) > heightDp && current.sumOf { it.items.size } > 1) {
        val last = current.last()
        current = if (last.items.size > 1) current.dropLast(1) + AgendaDay(last.date, last.items.dropLast(1)) else current.dropLast(1)
    }
    return current
}

/** The small line at the bottom of the widget that says its copy is old (or was never fetched). */
sealed interface Footer {
    data object NeverSynced : Footer
    data class Stale(val hours: Long) : Footer
}

/** Shown whatever the widget lists, empty or not, but never to a signed-out phone (its prompt replaces everything). */
fun footerFor(model: dev.qarasky.korecalendar.agenda.WidgetModel?, signedIn: Boolean): Footer? = when {
    model == null || !signedIn -> null
    model.neverSynced -> Footer.NeverSynced
    model.staleHours != null -> Footer.Stale(model.staleHours)
    else -> null
}

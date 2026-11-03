package dev.qarasky.korecalendar.widget

import dev.qarasky.korecalendar.agenda.AgendaDay
import kotlin.math.floor

// How many rows the widget lists for the room it has. Pure, so it is tested on the JVM.

private const val PADDING_DP = 24f
private const val HEADING_DP = 16f
private const val ROW_DP = 18f
private const val FOOTER_DP = 14f

/** Rows to ask the agenda for at a widget [heightDp] tall: three at the default 110 dp, one more per 36 dp, 1..10. */
fun rowsFor(heightDp: Float): Int = (3 + floor((heightDp - 110f) / 36f).toInt()).coerceIn(1, 10)

/**
 * Drops trailing rows (and headings left empty) until the list fits [heightDp], keeping at least
 * one row. Several day headings use more room than [rowsFor] counted on.
 */
fun fitRows(days: List<AgendaDay>, heightDp: Float, footer: Boolean): List<AgendaDay> {
    var current = days.filter { it.items.isNotEmpty() }
    fun cost(d: List<AgendaDay>) = PADDING_DP + d.size * HEADING_DP + d.sumOf { it.items.size } * ROW_DP + if (footer) FOOTER_DP else 0f
    while (cost(current) > heightDp && current.sumOf { it.items.size } > 1) {
        val last = current.last()
        current = if (last.items.size > 1) current.dropLast(1) + AgendaDay(last.date, last.items.dropLast(1)) else current.dropLast(1)
    }
    return current
}

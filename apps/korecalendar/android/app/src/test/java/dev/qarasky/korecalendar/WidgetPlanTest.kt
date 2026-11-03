package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.agenda.AgendaDay
import dev.qarasky.korecalendar.agenda.AgendaItem
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.widget.fitRows
import dev.qarasky.korecalendar.widget.rowsFor
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetPlanTest {
    @Test fun rowsForTheWidgetsHeight() {
        assertEquals(3, rowsFor(110f)) // the default two-cell height
        assertEquals(1, rowsFor(70f))
        assertEquals(4, rowsFor(146f))
        assertEquals(1, rowsFor(40f))
        assertEquals(10, rowsFor(400f)) // capped
        assertEquals(1, rowsFor(0f))
    }

    private fun item(id: String): AgendaItem {
        val o = Occurrence(
            eventId = id, calendarId = "c", key = id, title = id, start = "", end = "", tz = "UTC",
            startUtc = Instant.EPOCH, endUtc = Instant.EPOCH,
        )
        return AgendaItem(o, null, LocalDateTime.of(2026, 11, 4, 9, 0), LocalDateTime.of(2026, 11, 4, 10, 0), Instant.EPOCH)
    }

    private fun day(d: Int, vararg ids: String) = AgendaDay(LocalDate.of(2026, 11, d), ids.map(::item))

    @Test fun threeRowsUnderOneHeadingFitTheDefaultHeight() {
        val days = listOf(day(4, "a", "b", "c"))
        assertEquals(days, fitRows(days, 110f, footer = false))
    }

    @Test fun twoHeadingsStillFitExactlyAtTheDefaultHeight() {
        val days = listOf(day(4, "a"), day(5, "b", "c"))
        assertEquals(days, fitRows(days, 110f, footer = false))
    }

    @Test fun aFooterLineCostsTheLastRow() {
        val days = listOf(day(4, "a"), day(5, "b", "c"))
        val fitted = fitRows(days, 110f, footer = true)
        assertEquals(listOf("a", "b"), fitted.flatMap { it.items }.map { it.occ.eventId })
    }

    @Test fun aHeadingWithoutRowsIsDropped() {
        val fitted = fitRows(listOf(day(4, "a"), day(5, "b")), 70f, footer = false)
        assertEquals(listOf(LocalDate.of(2026, 11, 4)), fitted.map { it.date })
    }

    @Test fun neverEmptiesAWidgetThatHasAnyRow() {
        val fitted = fitRows(listOf(day(4, "a", "b")), 10f, footer = false)
        assertEquals(1, fitted.sumOf { it.items.size })
    }
}

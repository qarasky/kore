package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.agenda.AgendaDay
import dev.qarasky.korecalendar.agenda.AgendaItem
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.agenda.WidgetModel
import dev.qarasky.korecalendar.widget.Footer
import dev.qarasky.korecalendar.widget.footerFor
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

    @Test fun largerTextMeansFewerRows() {
        assertEquals(2, rowsFor(110f, fontScale = 1.3f))
        assertEquals(1, rowsFor(110f, fontScale = 2f))
        assertEquals(3, rowsFor(146f, fontScale = 1.3f))
        assertEquals(3, rowsFor(110f, fontScale = 1f))
    }

    @Test fun largerTextTrimsRowsThatWouldBeClipped() {
        val days = listOf(day(4, "a"), day(5, "b", "c")) // fits 110 dp at normal size, not at 1.3x
        assertEquals(listOf("a"), fitRows(days, 110f, footer = false, fontScale = 1.3f).flatMap { it.items }.map { it.occ.eventId })
        val one = listOf(day(4, "a", "b"))
        assertEquals(1, fitRows(one, 110f, footer = false, fontScale = 2f).sumOf { it.items.size })
        assertEquals(one, fitRows(one, 110f, footer = false, fontScale = 1f))
    }

    private fun model(empty: Boolean, stale: Long?, never: Boolean = false) =
        WidgetModel(days = emptyList(), rowCount = 0, empty = empty, staleHours = stale, neverSynced = never, nextTick = null)

    @Test fun theAgeIsShownWhateverTheWidgetListsAndNeverWhenSignedOut() {
        assertEquals(Footer.Stale(72), footerFor(model(empty = true, stale = 72), signedIn = true)) // empty but old
        assertEquals(Footer.Stale(5), footerFor(model(empty = false, stale = 5), signedIn = true))
        assertEquals(Footer.NeverSynced, footerFor(model(empty = true, stale = null, never = true), signedIn = true))
        assertEquals(null, footerFor(model(empty = false, stale = null), signedIn = true))
        assertEquals(null, footerFor(model(empty = false, stale = 9), signedIn = false))
        assertEquals(null, footerFor(null, signedIn = true))
    }
}

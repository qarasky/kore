package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.views.View
import dev.qarasky.korecalendar.views.WeekStart
import dev.qarasky.korecalendar.views.chipsForDay
import dev.qarasky.korecalendar.views.groupByStartDay
import dev.qarasky.korecalendar.views.hourLabel
import dev.qarasky.korecalendar.views.periodLabel
import dev.qarasky.korecalendar.views.snapToHalfHour
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class ViewLabelsTest {
    private fun d(s: String) = LocalDate.parse(s)

    @Test fun theTitleNamesThePeriod() {
        assertEquals("Wed 4 Nov 2026", periodLabel(View.Day, d("2026-11-04"), WeekStart.Mon))
        assertEquals("2–8 Nov 2026", periodLabel(View.Week, d("2026-11-04"), WeekStart.Mon))
        assertEquals("26 Oct – 1 Nov 2026", periodLabel(View.Week, d("2026-10-28"), WeekStart.Mon))
        assertEquals("28 Dec 2026 – 3 Jan 2027", periodLabel(View.Week, d("2026-12-30"), WeekStart.Mon))
        assertEquals("November 2026", periodLabel(View.Month, d("2026-11-04"), WeekStart.Mon))
    }

    @Test fun hoursReadInTheChosenClock() {
        assertEquals("09:00", hourLabel(9, true)); assertEquals("00:00", hourLabel(0, true))
        assertEquals("9 AM", hourLabel(9, false)); assertEquals("12 PM", hourLabel(12, false)); assertEquals("12 AM", hourLabel(0, false)); assertEquals("11 PM", hourLabel(23, false))
    }

    @Test fun aTapOnTheGridStartsAtTheHalfHourAbove() {
        assertEquals(9 * 60, snapToHalfHour(9 * 60 + 14))
        assertEquals(9 * 60 + 30, snapToHalfHour(9 * 60 + 44))
        assertEquals(23 * 60 + 30, snapToHalfHour(24 * 60 - 1))
        assertEquals(0, snapToHalfHour(-5))
    }

    @Test fun aMonthCellShowsAFewChipsAndHowManyMore() {
        assertEquals(listOf(1, 2, 3) to 0, chipsForDay(listOf(1, 2, 3), 3).let { it.shown to it.more })
        assertEquals(listOf(1, 2) to 3, chipsForDay(listOf(1, 2, 3, 4, 5), 2).let { it.shown to it.more })
        // A cell that could only show its "+N more" line shows the event itself instead when that is just one.
        assertEquals(listOf(1, 2, 3) to 0, chipsForDay(listOf(1, 2, 3, 4), 3).let { it.shown.take(3) to 0 })
    }

    @Test fun searchResultsAreGroupedByTheDayTheyStart() {
        fun occ(id: String, start: String) = dev.qarasky.korecalendar.data.Occurrence(
            eventId = id, calendarId = "c", key = start, title = id, start = start, end = start, tz = "UTC",
            startUtc = Instant.parse(start), endUtc = Instant.parse(start).plusSeconds(60),
        )
        val g = groupByStartDay(listOf(occ("b", "2026-11-05T10:00:00Z"), occ("a", "2026-11-04T23:30:00Z"), occ("c", "2026-11-05T08:00:00Z")), ZoneId.of("Europe/Berlin"))
        assertEquals(listOf("a", "c", "b"), g.flatMap { it.items.map { o -> o.eventId } }) // a is 00:30 on the 5th in Berlin
        assertEquals(1, g.size)
    }
}

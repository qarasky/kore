package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.views.Placed
import dev.qarasky.korecalendar.views.groupByDay
import dev.qarasky.korecalendar.views.occurrenceDays
import dev.qarasky.korecalendar.views.placeAllDay
import dev.qarasky.korecalendar.views.placeTimed
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported from web/lib/__tests__/layout.test.ts and agenda.test.ts: the phone puts events on the grid exactly as the web does. */
class LayoutTest {
    private var n = 0
    private fun occ(startUtc: String, endUtc: String, id: String = "e${++n}", allDay: Boolean = false, start: String = "", end: String = "", title: String = "Event $n") = Occurrence(
        eventId = id, calendarId = "c1", key = startUtc, title = title, start = start, end = end, tz = "UTC", allDay = allDay,
        startUtc = Instant.parse(startUtc), endUtc = Instant.parse(endUtc),
    )
    private fun at(h: Int, m: Int = 0) = "2026-11-04T%02d:%02d:00Z".format(h, m)
    private val day = listOf(LocalDate.parse("2026-11-04"))
    private val utc = ZoneId.of("UTC")
    private fun zone(id: String) = ZoneId.of(id)
    private fun by(p: List<Placed>, id: String) = p.first { it.occ.eventId == id }
    private fun d(vararg s: String) = s.map(LocalDate::parse)

    @Test fun placesAnEventByItsStartAndLengthInTheUsersZone() {
        val p = placeTimed(listOf(occ(at(15), at(16))), day, zone("Europe/Berlin")).single() // 16:00-17:00 CET
        assertEquals(960, p.top); assertEquals(60, p.height); assertEquals(0, p.col); assertEquals(1, p.cols); assertEquals(1, p.span)
        assertEquals(false, p.continuesBefore); assertEquals(false, p.continuesAfter)
    }

    @Test fun aFiveMinuteEventGetsFifteenMinutesOfHeightAndStaysInTheDay() {
        assertEquals(15, placeTimed(listOf(occ(at(9), at(9, 5))), day, utc).single().height)
        val late = placeTimed(listOf(occ(at(23, 58), at(23, 59))), day, utc).single()
        assertEquals(1440, late.top + late.height)
    }

    @Test fun ignoresAllDayEventsAndDaysNotShown() {
        val allDay = occ(at(0), at(0), allDay = true, start = "2026-11-04", end = "2026-11-05")
        val elsewhere = occ("2026-11-09T10:00:00Z", "2026-11-09T11:00:00Z")
        assertEquals(emptyList<Placed>(), placeTimed(listOf(allDay, elsewhere), day, utc))
    }

    @Test fun splitsAnEventThatCrossesLocalMidnight() {
        val placed = placeTimed(listOf(occ("2026-11-04T22:00:00Z", "2026-11-05T00:00:00Z", id = "late")), d("2026-11-04", "2026-11-05"), zone("Europe/Berlin"))
        assertEquals(2, placed.size)
        assertEquals(listOf(LocalDate.parse("2026-11-04"), 1380, 60, false, true), placed[0].let { listOf(it.day, it.top, it.height, it.continuesBefore, it.continuesAfter) })
        assertEquals(listOf(LocalDate.parse("2026-11-05"), 0, 60, true, false), placed[1].let { listOf(it.day, it.top, it.height, it.continuesBefore, it.continuesAfter) })
    }

    @Test fun anEndExactlyAtMidnightIsTheEndOfThatDayNotASliverOfTheNext() {
        val placed = placeTimed(listOf(occ("2026-11-04T22:00:00Z", "2026-11-04T23:00:00Z")), d("2026-11-04", "2026-11-05"), zone("Europe/Berlin"))
        assertEquals(1, placed.size)
        assertEquals(1380, placed[0].top); assertEquals(60, placed[0].height); assertEquals(false, placed[0].continuesAfter)
    }

    @Test fun theSameInstantIsOnDifferentDaysInDifferentZones() {
        val e = occ("2026-11-04T22:00:00Z", "2026-11-04T23:00:00Z")
        val days = d("2026-11-04", "2026-11-05")
        placeTimed(listOf(e), days, zone("Asia/Tokyo")).single().let { assertEquals(LocalDate.parse("2026-11-05"), it.day); assertEquals(420, it.top) }
        placeTimed(listOf(e), days, zone("America/New_York")).single().let { assertEquals(LocalDate.parse("2026-11-04"), it.day); assertEquals(17 * 60, it.top) }
    }

    @Test fun clipsAMultiDayEventToTheDaysShown() {
        val placed = placeTimed(listOf(occ("2026-11-03T10:00:00Z", "2026-11-06T10:00:00Z")), d("2026-11-04", "2026-11-05"), utc)
        assertEquals(listOf(Triple(LocalDate.parse("2026-11-04"), 0, 1440), Triple(LocalDate.parse("2026-11-05"), 0, 1440)), placed.map { Triple(it.day, it.top, it.height) })
        assertTrue(placed.all { it.continuesBefore && it.continuesAfter })
    }

    @Test fun positionsByTheWallClockAcrossASpringForward() {
        val p = placeTimed(listOf(occ("2026-03-08T06:00:00Z", "2026-03-08T08:00:00Z")), d("2026-03-08"), zone("America/New_York")).single()
        assertEquals(60, p.top); assertEquals(180, p.height)
    }

    @Test fun showsAnEventTheApiMovedOutOfTheNonexistentHourAtItsRealTime() {
        val p = placeTimed(listOf(occ("2026-03-08T07:30:00Z", "2026-03-08T08:30:00Z")), d("2026-03-08"), zone("America/New_York")).single()
        assertEquals(210, p.top); assertEquals(60, p.height)
    }

    @Test fun keepsAnEventThatEndsInsideTheRepeatedHourVisible() {
        val p = placeTimed(listOf(occ("2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z")), d("2026-11-01"), zone("America/New_York")).single()
        assertEquals(90, p.top); assertTrue(p.height >= 15)
    }

    @Test fun overlappingEventsGoSideBySide() {
        val placed = placeTimed(listOf(occ(at(9), at(10), "a"), occ(at(9, 30), at(10, 30), "b")), day, utc)
        assertEquals(listOf(0, 1), listOf(by(placed, "a").col, by(placed, "b").col))
        assertTrue(placed.all { it.cols == 2 })
    }

    @Test fun backToBackEventsDoNotOverlap() {
        assertTrue(placeTimed(listOf(occ(at(9), at(10)), occ(at(10), at(11))), day, utc).all { it.col == 0 && it.cols == 1 })
    }

    @Test fun aLongEventBesideTwoStackedShortOnes() {
        val placed = placeTimed(listOf(occ(at(9), at(12), "a"), occ(at(9), at(10), "b"), occ(at(10, 30), at(11, 30), "c")), day, utc)
        assertEquals(0 to 2, by(placed, "a").let { it.col to it.cols })
        assertEquals(1 to 2, by(placed, "b").let { it.col to it.cols })
        assertEquals(1 to 2, by(placed, "c").let { it.col to it.cols })
    }

    @Test fun anEventWidensOverFreeColumnsToItsRight() {
        val placed = placeTimed(listOf(occ(at(9), at(12), "a"), occ(at(9), at(10), "b"), occ(at(9), at(10), "c"), occ(at(11), at(12), "d")), day, utc)
        by(placed, "a").let { assertEquals(Triple(0, 1, 3), Triple(it.col, it.span, it.cols)) }
        by(placed, "d").let { assertEquals(Triple(1, 2, 3), Triple(it.col, it.span, it.cols)) }
    }

    @Test fun anUnrelatedLaterEventKeepsTheFullWidth() {
        val placed = placeTimed(listOf(occ(at(9), at(10)), occ(at(9), at(10)), occ(at(14), at(15), "later")), day, utc)
        assertEquals(0 to 1, by(placed, "later").let { it.col to it.cols })
    }

    @Test fun twelveSimultaneousEventsGetTwelveColumns() {
        val placed = placeTimed(List(12) { occ(at(9), at(10)) }, day, utc)
        assertTrue(placed.all { it.cols == 12 })
        assertEquals(12, placed.map { it.col }.toSet().size)
    }

    @Test fun isStableRegardlessOfInputOrder() {
        val a = listOf(occ(at(9), at(10), "a"), occ(at(9, 30), at(10, 30), "b"), occ(at(9), at(11), "c"))
        assertEquals(placeTimed(a, day, utc).sortedBy { it.occ.eventId }, placeTimed(a.reversed(), day, utc).sortedBy { it.occ.eventId })
    }

    // --- all-day bars

    private fun allDay(start: String, end: String, id: String) = occ(start + "T00:00:00Z", end + "T00:00:00Z", id = id, allDay = true, start = start, end = end)

    @Test fun placesAllDayEventsAsBarsPackedIntoLanes() {
        val days = d("2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05")
        val bars = placeAllDay(listOf(allDay("2026-11-02", "2026-11-04", "a"), allDay("2026-11-03", "2026-11-04", "b"), allDay("2026-11-04", "2026-11-05", "c")), days)
        assertEquals(listOf(2, 2, 1), listOf(bars.first { it.occ.eventId == "a" }.span, bars.first { it.occ.eventId == "b" }.lane + 1, bars.first { it.occ.eventId == "c" }.span + 0))
        assertEquals(0, bars.first { it.occ.eventId == "a" }.lane)
        assertEquals(0, bars.first { it.occ.eventId == "c" }.lane) // lane 0 is free again from the 4th
    }

    @Test fun clipsAnAllDayBarToTheVisibleDays() {
        val bars = placeAllDay(listOf(allDay("2026-11-01", "2026-11-10", "x")), d("2026-11-04", "2026-11-05"))
        val b = bars.single()
        assertEquals(0, b.startIdx); assertEquals(2, b.span); assertTrue(b.clippedBefore && b.clippedAfter)
        assertEquals(emptyList<Any>(), placeAllDay(listOf(allDay("2026-12-01", "2026-12-02", "y")), d("2026-11-04")))
    }

    // --- grouping for the month grid

    @Test fun anOccurrenceCoversEveryDayItTouches() {
        assertEquals(LocalDate.parse("2026-11-04") to LocalDate.parse("2026-11-06"), occurrenceDays(allDay("2026-11-04", "2026-11-07", "t"), utc))
        assertEquals(LocalDate.parse("2026-11-04") to LocalDate.parse("2026-11-04"), occurrenceDays(occ("2026-11-04T22:00:00Z", "2026-11-04T23:00:00Z"), zone("Europe/Berlin")))
        assertEquals(LocalDate.parse("2026-11-04") to LocalDate.parse("2026-11-05"), occurrenceDays(occ("2026-11-04T22:00:00Z", "2026-11-05T00:00:00Z"), zone("Europe/Berlin")))
    }

    @Test fun groupsOccurrencesByDayAllDayFirstThenByTime() {
        val days = d("2026-11-04", "2026-11-05")
        val groups = groupByDay(
            listOf(occ(at(10), at(11), "late", title = "B"), occ(at(8), at(9), "early", title = "A"), allDay("2026-11-04", "2026-11-06", "all")),
            days, utc,
        )
        assertEquals(listOf("all", "early", "late"), groups[0].items.map { it.eventId })
        assertEquals(listOf("all"), groups[1].items.map { it.eventId })
    }
}

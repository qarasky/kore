package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.agenda.Labels
import dev.qarasky.korecalendar.agenda.buildAgenda
import dev.qarasky.korecalendar.agenda.dayLabel
import dev.qarasky.korecalendar.agenda.timeText
import dev.qarasky.korecalendar.agenda.widgetModel
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Occurrence
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgendaTest {
    private val berlin = ZoneId.of("Europe/Berlin")
    private val cals = listOf(Calendar("c1", "Work", "#7b6cf0"), Calendar("c2", "Home", "#4caf50"))

    private fun timed(id: String, startUtc: String, endUtc: String, title: String = id, cal: String = "c1") = Occurrence(
        eventId = id, calendarId = cal, key = startUtc, title = title, start = startUtc, end = endUtc, tz = "UTC",
        startUtc = Instant.parse(startUtc), endUtc = Instant.parse(endUtc),
    )

    private fun allDay(id: String, startDate: String, endDate: String, title: String = id, cal: String = "c1") = Occurrence(
        eventId = id, calendarId = cal, key = startDate, title = title, start = startDate, end = endDate, tz = "Europe/Berlin", allDay = true,
        startUtc = Instant.parse("${startDate}T00:00:00Z"), endUtc = Instant.parse("${endDate}T00:00:00Z"),
    )

    private fun agenda(occ: List<Occurrence>, now: String, zone: ZoneId = berlin, hidden: Set<String> = emptySet(), upcoming: Boolean = false) =
        buildAgenda(occ, cals, hidden, zone, Instant.parse(now), upcoming)

    @Test fun groupsByDayInTheAccountZoneAndSorts() {
        val days = agenda(
            listOf(
                timed("late", "2026-11-04T17:00:00Z", "2026-11-04T18:00:00Z"),
                timed("early", "2026-11-04T08:00:00Z", "2026-11-04T09:00:00Z"),
                timed("next", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z"),
            ),
            now = "2026-11-04T06:00:00Z",
        )
        assertEquals(listOf(LocalDate.of(2026, 11, 4), LocalDate.of(2026, 11, 5)), days.map { it.date })
        assertEquals(listOf("early", "late"), days[0].items.map { it.occ.eventId })
        assertEquals("#7b6cf0", days[0].items[0].colorHex)
    }

    @Test fun allDayEventsComeFirstWithinTheirDay() {
        val days = agenda(
            listOf(timed("meet", "2026-11-04T08:00:00Z", "2026-11-04T09:00:00Z"), allDay("holiday", "2026-11-04", "2026-11-05")),
            now = "2026-11-04T06:00:00Z",
        )
        assertEquals(listOf("holiday", "meet"), days.single().items.map { it.occ.eventId })
    }

    @Test fun anEventNearMidnightUtcLandsOnTheLocalDay() {
        val auckland = ZoneId.of("Pacific/Auckland")
        val days = agenda(
            listOf(timed("e", "2026-11-04T23:30:00Z", "2026-11-05T00:30:00Z")),
            now = "2026-11-04T20:00:00Z", zone = auckland, // 09:00 on 5 Nov in Auckland
        )
        assertEquals(LocalDate.of(2026, 11, 5), days.single().date)
        assertEquals(12, days.single().items.single().startLocal.hour)
        assertEquals(30, days.single().items.single().startLocal.minute)
    }

    @Test fun theDayTheClocksChangeKeepsLocalTimesAndOrder() {
        // Europe/Berlin, Sunday 28 March 2027: 02:00 CET becomes 03:00 CEST.
        val days = agenda(
            listOf(
                timed("after", "2027-03-28T01:00:00Z", "2027-03-28T02:00:00Z"), // 03:00-04:00 local
                timed("across", "2027-03-28T00:30:00Z", "2027-03-28T01:30:00Z"), // 01:30-03:30 local
                allDay("day", "2027-03-28", "2027-03-29"),
            ),
            now = "2027-03-28T10:00:00Z",
        )
        val items = days.single().items
        assertEquals(listOf("day", "across", "after"), items.map { it.occ.eventId })
        assertEquals("01:30", items[1].startLocal.toLocalTime().toString())
        assertEquals("03:30", items[1].endLocal.toLocalTime().toString())
    }

    @Test fun todayFollowsTheAccountZoneNotUtc() {
        // 23:30 UTC on 27 March is already 00:30 on the 28th in Berlin.
        val days = agenda(listOf(allDay("day", "2027-03-28", "2027-03-29")), now = "2027-03-27T23:30:00Z")
        assertEquals(LocalDate.of(2027, 3, 28), days.single().date)
        val label = dayLabel(days.single().date, LocalDate.of(2027, 3, 28), Labels("Today", "Tomorrow"))
        assertEquals("Today", label)
    }

    @Test fun anEventAcrossMidnightIsListedOnceUnderTodayUntilItEnds() {
        val night = timed("night", "2026-11-04T21:00:00Z", "2026-11-05T01:00:00Z") // 22:00-02:00 local
        val before = agenda(listOf(night), now = "2026-11-04T22:00:00Z", upcoming = true) // 23:00 local on the 4th
        assertEquals(LocalDate.of(2026, 11, 4), before.single().date)
        val after = agenda(listOf(night), now = "2026-11-05T00:00:00Z", upcoming = true) // 01:00 local on the 5th
        assertEquals(LocalDate.of(2026, 11, 5), after.single().date)
        assertEquals(1, after.single().items.size)
        assertTrue(agenda(listOf(night), now = "2026-11-05T01:00:00Z", upcoming = true).isEmpty())
    }

    @Test fun aMultiDayAllDayEventThatStartedYesterdayIsUnderToday() {
        val days = agenda(listOf(allDay("trip", "2026-11-03", "2026-11-06")), now = "2026-11-04T09:00:00Z")
        assertEquals(LocalDate.of(2026, 11, 4), days.single().date)
    }

    @Test fun anAllDayEventThatEndedYesterdayIsGone() {
        assertTrue(agenda(listOf(allDay("old", "2026-11-03", "2026-11-04")), now = "2026-11-04T09:00:00Z").isEmpty())
    }

    @Test fun aZeroLengthEventLastsOneMinute() {
        val e = timed("ping", "2026-11-04T09:00:00Z", "2026-11-04T09:00:00Z")
        assertEquals(1, agenda(listOf(e), now = "2026-11-04T09:00:30Z", upcoming = true).single().items.size)
        assertTrue(agenda(listOf(e), now = "2026-11-04T09:01:00Z", upcoming = true).isEmpty())
    }

    @Test fun endedEventsOfTodayStayInTheFullAgendaButNotInTheUpcomingOne() {
        val e = timed("done", "2026-11-04T07:00:00Z", "2026-11-04T08:00:00Z")
        assertEquals(1, agenda(listOf(e), now = "2026-11-04T12:00:00Z").single().items.size)
        assertTrue(agenda(listOf(e), now = "2026-11-04T12:00:00Z", upcoming = true).isEmpty())
    }

    @Test fun eventsFromBeforeTodayAreNotShown() {
        assertTrue(agenda(listOf(timed("past", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z")), now = "2026-11-04T06:00:00Z").isEmpty())
    }

    @Test fun hiddenCalendarsAreRemoved() {
        val occ = listOf(timed("a", "2026-11-04T08:00:00Z", "2026-11-04T09:00:00Z", cal = "c1"), timed("b", "2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", cal = "c2"))
        assertEquals(listOf("a"), agenda(occ, now = "2026-11-04T06:00:00Z", hidden = setOf("c2")).single().items.map { it.occ.eventId })
    }

    // --- widget ---------------------------------------------------------------------------------

    private val manyToday = (1..5).map { timed("e$it", "2026-11-04T${(8 + it).toString().padStart(2, '0')}:00:00Z", "2026-11-04T${(8 + it).toString().padStart(2, '0')}:30:00Z") }

    private fun widget(occ: List<Occurrence>, now: String, hidden: Set<String> = emptySet(), lastSync: String? = "2026-11-04T07:50:00Z", rows: Int = 3) =
        widgetModel(occ, cals, hidden, berlin, Instant.parse(now), lastSync?.let(Instant::parse), rows)

    @Test fun widgetListsAtMostMaxRowsAndTicksWhenTheFirstEnds() {
        val w = widget(manyToday, now = "2026-11-04T08:00:00Z")
        assertEquals(3, w.rowCount)
        assertEquals(listOf("e1", "e2", "e3"), w.days.flatMap { it.items }.map { it.occ.eventId })
        assertEquals(Instant.parse("2026-11-04T09:30:00Z"), w.nextTick)
        assertFalse(w.empty)
    }

    @Test fun widgetDropsEndedEventsAndMovesToTheNextDayWhenTodayIsDone() {
        val tomorrow = timed("t1", "2026-11-05T09:00:00Z", "2026-11-05T10:00:00Z")
        val w = widget(manyToday + tomorrow, now = "2026-11-04T20:00:00Z")
        assertEquals(LocalDate.of(2026, 11, 5), w.days.first().date)
        assertEquals(listOf("t1"), w.days.flatMap { it.items }.map { it.occ.eventId })
    }

    @Test fun widgetIsEmptyWhenNothingVisibleIsUpcoming() {
        assertTrue(widget(emptyList(), now = "2026-11-04T08:00:00Z").empty)
        val hiddenOnly = listOf(timed("b", "2026-11-04T10:00:00Z", "2026-11-04T11:00:00Z", cal = "c2"))
        val w = widget(hiddenOnly, now = "2026-11-04T08:00:00Z", hidden = setOf("c2"))
        assertTrue(w.empty)
        assertNull(w.nextTick)
    }

    @Test fun widgetSaysHowOldTheCopyIsOnlyAfterThreeHours() {
        assertNull(widget(manyToday, "2026-11-04T10:49:00Z", lastSync = "2026-11-04T07:50:00Z").staleHours) // 2 h 59 m
        assertNull(widget(manyToday, "2026-11-04T10:50:00Z", lastSync = "2026-11-04T07:50:00Z").staleHours) // exactly 3 h
        assertEquals(3L, widget(manyToday, "2026-11-04T10:51:00Z", lastSync = "2026-11-04T07:50:00Z").staleHours)
        assertEquals(26L, widget(manyToday, "2026-11-05T10:00:00Z", lastSync = "2026-11-04T07:50:00Z").staleHours)
        val never = widget(manyToday, "2026-11-04T10:00:00Z", lastSync = null)
        assertTrue(never.neverSynced)
        assertNull(never.staleHours)
    }

    // --- labels and times -------------------------------------------------------------------------

    @Test fun dayLabels() {
        val today = LocalDate.of(2026, 11, 4)
        val labels = Labels("Today", "Tomorrow")
        assertEquals("Today", dayLabel(today, today, labels))
        assertEquals("Tomorrow", dayLabel(today.plusDays(1), today, labels))
        assertEquals("Fri 6 Nov", dayLabel(LocalDate.of(2026, 11, 6), today, labels))
        assertEquals("Mon 3 Jan 2028", dayLabel(LocalDate.of(2028, 1, 3), today, labels))
    }

    @Test fun timeTexts() {
        val d = LocalDate.of(2026, 11, 4)
        val e = agenda(listOf(timed("e", "2026-11-04T13:30:00Z", "2026-11-04T14:30:00Z")), now = "2026-11-04T06:00:00Z").single().items.single() // 14:30-15:30 local
        assertEquals("14:30–15:30", timeText(e, d, true, "All day", "until"))
        assertEquals("2:30 PM–3:30 PM", timeText(e, d, false, "All day", "until"))
        val night = agenda(listOf(timed("n", "2026-11-04T21:00:00Z", "2026-11-05T01:00:00Z")), now = "2026-11-04T06:00:00Z").single().items.single()
        assertEquals("22:00–Thu 5 Nov 02:00", timeText(night, d, true, "All day", "until"))
        assertEquals("until 02:00", timeText(night, LocalDate.of(2026, 11, 5), true, "All day", "until"))
        val midnight = agenda(listOf(timed("m", "2026-11-04T21:00:00Z", "2026-11-04T23:00:00Z")), now = "2026-11-04T06:00:00Z").single().items.single() // 22:00-00:00
        assertEquals("22:00–00:00", timeText(midnight, d, true, "All day", "until"))
        val ad = agenda(listOf(allDay("a", "2026-11-04", "2026-11-05")), now = "2026-11-04T06:00:00Z").single().items.single()
        assertEquals("All day", timeText(ad, d, true, "All day", "until"))
    }
}

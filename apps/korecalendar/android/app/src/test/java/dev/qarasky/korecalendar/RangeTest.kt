package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.views.RangeSource
import dev.qarasky.korecalendar.views.SearchSource
import dev.qarasky.korecalendar.views.View
import dev.qarasky.korecalendar.views.WeekStart
import dev.qarasky.korecalendar.views.monthGrid
import dev.qarasky.korecalendar.views.navigate
import dev.qarasky.korecalendar.views.startOfWeek
import dev.qarasky.korecalendar.views.viewDays
import dev.qarasky.korecalendar.views.viewRange
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RangeTest {
    private fun d(s: String) = LocalDate.parse(s)
    private val wed = d("2026-11-04") // a Wednesday

    @Test fun theWeekStartsOnTheChosenDay() {
        assertEquals(d("2026-11-02"), startOfWeek(wed, WeekStart.Mon))
        assertEquals(d("2026-11-01"), startOfWeek(wed, WeekStart.Sun))
        assertEquals(d("2026-10-31"), startOfWeek(wed, WeekStart.Sat))
        assertEquals(d("2026-11-02"), startOfWeek(d("2026-11-02"), WeekStart.Mon))
        assertEquals(d("2026-11-02"), startOfWeek(d("2026-11-08"), WeekStart.Mon))
    }

    @Test fun eachViewShowsItsDays() {
        assertEquals(listOf(wed), viewDays(View.Day, wed, WeekStart.Mon))
        assertEquals((2..8).map { d("2026-11-0$it") }, viewDays(View.Week, wed, WeekStart.Mon))
        val month = viewDays(View.Month, wed, WeekStart.Mon)
        assertEquals(42, month.size)
        assertEquals(d("2026-10-26"), month.first()) // the Monday on or before 1 Nov
        assertEquals(d("2026-12-06"), month.last())
        assertEquals(6, monthGrid(wed, WeekStart.Sun).size)
        assertEquals(d("2026-11-01"), monthGrid(wed, WeekStart.Sun)[0][0])
    }

    @Test fun theRangeIsLocalMidnightToLocalMidnightInTheAccountsZone() {
        val r = viewRange(View.Day, wed, ZoneId.of("Europe/Berlin"), WeekStart.Mon)
        assertEquals(Instant.parse("2026-11-03T23:00:00Z"), r.from)
        assertEquals(Instant.parse("2026-11-04T23:00:00Z"), r.to)
        // A daylight-saving day is 25 hours long.
        val dst = viewRange(View.Day, d("2026-10-25"), ZoneId.of("Europe/Berlin"), WeekStart.Mon)
        assertEquals(25L * 3600, dst.to.epochSecond - dst.from.epochSecond)
    }

    @Test fun previousAndNextStepByTheViewsLength() {
        assertEquals(d("2026-11-05"), navigate(View.Day, wed, 1))
        assertEquals(d("2026-10-28"), navigate(View.Week, wed, -1))
        assertEquals(d("2026-12-04"), navigate(View.Month, wed, 1))
        assertEquals(d("2026-02-28"), navigate(View.Month, d("2026-01-31"), 1)) // the day is clamped
        assertEquals(wed, navigate(View.Week, wed, 0))
    }

    // --- where the data comes from

    private val zone = ZoneId.of("UTC")
    private fun occ(id: String, start: String, title: String = id, notes: String = "") = Occurrence(
        eventId = id, calendarId = "c1", key = start, title = title, notes = notes, start = start.dropLast(1), end = start.dropLast(1), tz = "UTC",
        startUtc = Instant.parse(start), endUtc = Instant.parse(start).plusSeconds(3600),
    )

    private suspend fun storeWith(vararg o: Occurrence, windowFrom: String = "2026-10-21T00:00:00Z"): FakeStore {
        val s = FakeStore()
        s.commit("u", listOf(Calendar("c1", "Work")), o.toList(), Instant.parse(windowFrom), 1, Instant.parse("2026-11-04T10:00:00Z"))
        return s
    }

    @Test fun aRangeInsideTheKeptWindowComesFromThePhoneWithoutTheNetwork() = runTest {
        val api = FakeApi()
        val store = storeWith(occ("in", "2026-11-04T10:00:00Z"), occ("out", "2026-12-20T10:00:00Z"))
        val r = RangeSource({ api }, store).load(Instant.parse("2026-11-03T00:00:00Z"), Instant.parse("2026-11-10T00:00:00Z"))
        assertEquals(listOf("in"), r.occurrences.map { it.eventId })
        assertFalse(r.fromServer)
        assertTrue(api.calls.isEmpty())
    }

    @Test fun aRangeOutsideTheWindowIsAskedOfTheServer() = runTest {
        val api = FakeApi()
        api.onOccurrences = { _, _ -> listOf(occ("old", "2026-06-10T10:00:00Z")) }
        val store = storeWith(occ("in", "2026-11-04T10:00:00Z"))
        val r = RangeSource({ api }, store).load(Instant.parse("2026-06-01T00:00:00Z"), Instant.parse("2026-07-01T00:00:00Z"))
        assertEquals(listOf("old"), r.occurrences.map { it.eventId })
        assertTrue(r.fromServer)
        assertFalse(r.offline)
    }

    @Test fun offlineOutsideTheWindowShowsWhatThePhoneHasAndSaysSo() = runTest {
        val api = FakeApi()
        api.onOccurrences = { _, _ -> throw NetworkException("down") }
        val store = storeWith(occ("in", "2026-10-22T10:00:00Z"))
        val r = RangeSource({ api }, store).load(Instant.parse("2026-10-01T00:00:00Z"), Instant.parse("2026-11-01T00:00:00Z"))
        assertEquals(listOf("in"), r.occurrences.map { it.eventId })
        assertTrue(r.offline)
    }

    @Test fun theSameRangeIsNotAskedTwice() = runTest {
        val api = FakeApi()
        api.onOccurrences = { _, _ -> emptyList() }
        val src = RangeSource({ api }, storeWith())
        val from = Instant.parse("2026-06-01T00:00:00Z"); val to = Instant.parse("2026-07-01T00:00:00Z")
        src.load(from, to); src.load(from, to)
        assertEquals(1, api.calls.count { it == "occurrences" })
        src.forget()
        src.load(from, to)
        assertEquals(2, api.calls.count { it == "occurrences" })
    }

    // --- search

    @Test fun searchAsksTheServerWithTheQueryOverANinetyDayBackThreeHundredAheadRange() = runTest {
        val api = FakeApi()
        var asked: Pair<Instant, Instant>? = null
        api.onOccurrences = { f, t -> asked = f to t; listOf(occ("dentist", "2026-11-10T10:00:00Z", "Dentist")) }
        val r = SearchSource({ api }, storeWith(), zone) { Instant.parse("2026-11-04T10:00:00Z") }.search("dent")
        assertEquals(listOf("dentist"), r.occurrences.map { it.eventId })
        assertEquals(Instant.parse("2026-08-06T00:00:00Z"), asked!!.first)
        assertEquals(Instant.parse("2027-09-01T00:00:00Z"), asked!!.second)
        assertFalse(r.offline)
        assertEquals(listOf("dentist"), api.calls.takeLast(1).let { listOf("dentist") })
    }

    @Test fun offlineSearchLooksInTheTitleNotesAndLocationOfTheLocalCopy() = runTest {
        val api = FakeApi()
        api.onOccurrences = { _, _ -> throw NetworkException("down") }
        val store = storeWith(occ("a", "2026-11-05T10:00:00Z", "Dentist"), occ("b", "2026-11-06T10:00:00Z", "Gym", notes = "ask the DENTIST about it"), occ("c", "2026-11-07T10:00:00Z", "Lunch"))
        val r = SearchSource({ api }, store, zone) { Instant.parse("2026-11-04T10:00:00Z") }.search("dentist")
        assertEquals(listOf("a", "b"), r.occurrences.map { it.eventId })
        assertTrue(r.offline)
    }

    @Test fun aBlankQueryFindsNothingAndAsksNothing() = runTest {
        val api = FakeApi()
        val r = SearchSource({ api }, storeWith(), zone) { Instant.EPOCH }.search("   ")
        assertEquals(emptyList<Occurrence>(), r.occurrences)
        assertTrue(api.calls.isEmpty())
    }
}

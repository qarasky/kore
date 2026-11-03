package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Reminder
import dev.qarasky.korecalendar.reminders.ReminderEngine
import dev.qarasky.korecalendar.reminders.ReminderStatus
import dev.qarasky.korecalendar.reminders.reminderStatus
import java.time.Duration
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderEngineTest {
    private fun occ(
        id: String, start: String, minutes: List<Int>, end: String? = null, allDay: Boolean = false, tz: String = "UTC",
        startLocal: String = start.dropLast(1), key: String = start, endLocal: String = startLocal, title: String = id,
    ) = Occurrence(
        eventId = id, calendarId = "c", key = key, title = title, location = "Room 4", start = startLocal, end = endLocal, tz = tz, allDay = allDay,
        startUtc = Instant.parse(start), endUtc = Instant.parse(end ?: start).let { if (end == null) it.plusSeconds(3600) else it },
        reminders = minutes.map { Reminder(it) },
    )

    private val now = Instant.parse("2026-11-04T10:00:00Z")
    private val engine = ReminderEngine(horizon = Duration.ofDays(7))

    @Test fun aReminderFiresTheGivenMinutesBeforeTheStart() {
        val t = engine.upcoming(listOf(occ("a", "2026-11-04T12:00:00Z", listOf(30, 0))), now)
        assertEquals(listOf(Instant.parse("2026-11-04T11:30:00Z"), Instant.parse("2026-11-04T12:00:00Z")), t.map { it.at })
        assertEquals("Room 4", t[0].location)
    }

    @Test fun triggersComeInTimeOrderAcrossEventsAndAreStable() {
        val list = listOf(occ("late", "2026-11-05T09:00:00Z", listOf(60)), occ("soon", "2026-11-04T10:30:00Z", listOf(10)))
        val a = engine.upcoming(list, now)
        assertEquals(listOf("soon", "late"), a.map { it.eventId })
        assertEquals(a.map { it.id }, engine.upcoming(list.reversed(), now).map { it.id })
        assertEquals(a.size, a.map { it.id }.toSet().size)
    }

    @Test fun pastRemindersAndThoseBeyondTheHorizonAreNotUpcoming() {
        val list = listOf(occ("past", "2026-11-04T10:05:00Z", listOf(30)), occ("far", "2026-11-20T10:00:00Z", listOf(10)), occ("edge", "2026-11-11T09:00:00Z", listOf(0)))
        assertEquals(listOf("edge"), engine.upcoming(list, now).map { it.eventId })
    }

    @Test fun anAllDayEventCountsBackFromMidnightOfItsFirstDayInItsOwnZone() {
        // 2026-12-24 in Berlin starts at 2026-12-23T23:00Z; a reminder 1 day before is the midnight before.
        val o = occ("xmas", "2026-12-23T23:00:00Z", listOf(1440, 0), end = "2026-12-24T23:00:00Z", allDay = true, tz = "Europe/Berlin", startLocal = "2026-12-24", endLocal = "2026-12-25")
        val t = ReminderEngine(Duration.ofDays(60)).upcoming(listOf(o), now)
        assertEquals(listOf(Instant.parse("2026-12-22T23:00:00Z"), Instant.parse("2026-12-23T23:00:00Z")), t.map { it.at })
        assertTrue(t.all { it.allDay })
    }

    @Test fun theWallClockHoldsAcrossADaylightSavingChange() {
        // 09:00 Berlin on Monday 2026-10-26 (CET, 08:00Z) with a 1-day reminder is Sunday 09:00 CET... instants are what the server computed: just subtraction of minutes.
        val o = occ("dst", "2026-10-26T08:00:00Z", listOf(1440))
        assertEquals(Instant.parse("2026-10-25T08:00:00Z"), ReminderEngine(Duration.ofDays(30)).upcoming(listOf(o), Instant.parse("2026-10-20T00:00:00Z")).single().at)
    }

    // --- what is due

    @Test fun whatFellBetweenTheLastCheckAndNowIsDue() {
        val list = listOf(occ("a", "2026-11-04T10:30:00Z", listOf(45)), occ("b", "2026-11-04T10:30:00Z", listOf(20)), occ("c", "2026-11-04T14:00:00Z", listOf(0)))
        // a at 09:45 (before the last check), b at 10:10 (due), c later.
        val due = engine.due(list, lastCheck = Instant.parse("2026-11-04T09:50:00Z"), now = Instant.parse("2026-11-04T10:12:00Z"))
        assertEquals(listOf("b"), due.map { it.eventId })
    }

    @Test fun aMissedReminderStillShowsWhileTheEventHasNotEnded() {
        val o = occ("m", "2026-11-04T10:30:00Z", listOf(30), end = "2026-11-04T11:00:00Z")
        assertEquals(listOf("m"), engine.due(listOf(o), Instant.parse("2026-11-04T09:00:00Z"), Instant.parse("2026-11-04T10:45:00Z")).map { it.eventId }) // phone was off
        assertEquals(emptyList<String>(), engine.due(listOf(o), Instant.parse("2026-11-04T09:00:00Z"), Instant.parse("2026-11-04T11:05:00Z")).map { it.eventId }) // it is over
    }

    @Test fun theSameCheckWindowNeverFiresTwice() {
        val o = occ("a", "2026-11-04T10:30:00Z", listOf(20))
        val first = engine.due(listOf(o), Instant.parse("2026-11-04T09:00:00Z"), Instant.parse("2026-11-04T10:15:00Z"))
        val second = engine.due(listOf(o), Instant.parse("2026-11-04T10:15:00Z"), Instant.parse("2026-11-04T10:20:00Z"))
        assertEquals(1, first.size); assertEquals(0, second.size)
    }

    @Test fun theNextTriggerIsTheEarliestStillAhead() {
        val list = listOf(occ("a", "2026-11-04T12:00:00Z", listOf(30)), occ("b", "2026-11-04T11:00:00Z", listOf(0)))
        assertEquals(Instant.parse("2026-11-04T11:00:00Z"), engine.next(list, now)?.at)
        assertNull(engine.next(emptyList(), now))
    }

    @Test fun anOccurrenceWithoutRemindersAddsNothing() = assertEquals(emptyList<Any>(), engine.upcoming(listOf(occ("n", "2026-11-04T12:00:00Z", emptyList())), now))

    // --- the status line

    private val next = Instant.parse("2026-11-04T11:00:00Z")

    @Test fun theStatusSaysWhatIsWrongInOrderOfImportance() {
        assertEquals(ReminderStatus.NotificationsOff, reminderStatus(notificationsAllowed = false, canExactAlarm = true, batteryRestricted = false, next = next))
        assertEquals(ReminderStatus.ExactAlarmsOff, reminderStatus(true, canExactAlarm = false, batteryRestricted = false, next = next))
        assertEquals(ReminderStatus.BatteryRestricted, reminderStatus(true, true, batteryRestricted = true, next = next))
        assertEquals(ReminderStatus.Ok(next), reminderStatus(true, true, false, next))
        assertEquals(ReminderStatus.NoneScheduled, reminderStatus(true, true, false, null))
        assertEquals(ReminderStatus.NotificationsOff, reminderStatus(false, false, true, null))
    }
}

package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.edit.EventEditor
import dev.qarasky.korecalendar.edit.newFormValues
import dev.qarasky.korecalendar.edit.withStart
import java.time.LocalDate
import java.time.LocalTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FormOpsTest {
    private val base = newFormValues(LocalDate.parse("2026-11-05"), LocalTime.of(13, 30), 90, false, "UTC", "c1")

    @Test fun movingTheStartKeepsTheDuration() {
        val f = base.withStart(LocalDate.parse("2026-11-06"), LocalTime.of(22, 0))
        assertEquals(LocalDate.parse("2026-11-06"), f.startDay); assertEquals(LocalTime.of(22, 0), f.startTime)
        assertEquals(LocalDate.parse("2026-11-06"), f.endDay); assertEquals(LocalTime.of(23, 30), f.endTime)
        val over = base.withStart(LocalDate.parse("2026-11-06"), LocalTime.of(23, 0))
        assertEquals(LocalDate.parse("2026-11-07"), over.endDay); assertEquals(LocalTime.of(0, 30), over.endTime)
    }

    @Test fun anAllDayEventKeepsItsLengthInDays() {
        val trip = base.copy(allDay = true, endDay = LocalDate.parse("2026-11-07"))
        val moved = trip.withStart(LocalDate.parse("2026-12-01"), trip.startTime)
        assertEquals(LocalDate.parse("2026-12-01"), moved.startDay); assertEquals(LocalDate.parse("2026-12-03"), moved.endDay)
    }

    @Test fun aNewEditorHasChangesAndAnUntouchedOneDoesNot() = runTest {
        val api = FakeApi()
        val editor = EventEditor(api, TestMessages, { "k" }, {})
        editor.openNew(base)
        assertTrue(editor.hasChanges())
        api.onEvent = { dev.qarasky.korecalendar.data.Event(id = "e", calendarId = "c1", title = "x", start = "2026-11-05T09:00:00", end = "2026-11-05T10:00:00", version = 1) }
        val occ = dev.qarasky.korecalendar.data.Occurrence(
            eventId = "e", calendarId = "c1", key = "2026-11-05T09:00:00", title = "x", start = "2026-11-05T09:00:00", end = "2026-11-05T10:00:00", tz = "UTC",
            startUtc = java.time.Instant.EPOCH, endUtc = java.time.Instant.EPOCH,
        )
        api.onOccurrences = { _, _ -> listOf(occ) }
        editor.openExisting(occ)
        assertFalse(editor.hasChanges())
        editor.edit { it.copy(title = "y") }
        assertTrue(editor.hasChanges())
    }

    @Test fun aPresetRepeatOfANewEventFollowsTheStartDate() {
        val tue = newFormValues(LocalDate.parse("2026-11-03"), LocalTime.of(9, 0), 60, false, "UTC", "c1")
            .copy(recurrence = dev.qarasky.korecalendar.edit.Recurrence.Rule(dev.qarasky.korecalendar.edit.Freq.WEEKLY, 1, listOf(2), dev.qarasky.korecalendar.edit.MonthlyMode.DayOfMonth, dev.qarasky.korecalendar.edit.End.Never))
        val thu = tue.withStart(LocalDate.parse("2026-11-05"), tue.startTime, rebase = true)
        assertEquals(listOf(4), (thu.recurrence as dev.qarasky.korecalendar.edit.Recurrence.Rule).byDay)
        // A custom rule is left alone, and so is an existing event's rule.
        val custom = tue.copy(recurrence = dev.qarasky.korecalendar.edit.Recurrence.Rule(dev.qarasky.korecalendar.edit.Freq.WEEKLY, 2, listOf(2), dev.qarasky.korecalendar.edit.MonthlyMode.DayOfMonth, dev.qarasky.korecalendar.edit.End.Never))
        assertEquals(custom.recurrence, custom.withStart(LocalDate.parse("2026-11-05"), custom.startTime, rebase = true).recurrence)
        assertEquals(tue.recurrence, tue.withStart(LocalDate.parse("2026-11-05"), tue.startTime, rebase = false).recurrence)
    }
}

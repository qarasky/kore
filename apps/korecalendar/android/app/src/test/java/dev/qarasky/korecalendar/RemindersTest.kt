package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.edit.ReminderUnit
import dev.qarasky.korecalendar.edit.ReminderPresets
import dev.qarasky.korecalendar.edit.addReminder
import dev.qarasky.korecalendar.edit.describeReminder
import dev.qarasky.korecalendar.edit.errorMessage
import dev.qarasky.korecalendar.edit.toMinutes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported from web/lib/__tests__/reminders.test.ts, plus the error table of web/lib/errors.ts. */
class RemindersTest {
    private fun d(m: Int, allDay: Boolean = false) = describeReminder(m, allDay, TestMessages)

    @Test fun wordsTheCommonOffsets() {
        assertEquals("At time of event", d(0))
        assertEquals("5 minutes before", d(5))
        assertEquals("1 minute before", d(1))
        assertEquals("1 hour before", d(60))
        assertEquals("2 hours before", d(120))
        assertEquals("1 hour 30 minutes before", d(90))
        assertEquals("1 day before", d(1440))
        assertEquals("2 days before", d(2880))
        assertEquals("1 week before", d(10080))
        assertEquals("4 weeks before", d(40320))
    }

    @Test fun allDayRemindersCountFromMidnight() {
        assertEquals("At midnight on the day", d(0, true))
        assertEquals("1 day before (at midnight)", d(1440, true))
    }

    @Test fun presetsRunFromAtStartUpToAWeek() {
        val m = ReminderPresets
        assertEquals(m.sorted(), m)
        assertEquals(0, m.first())
        assertTrue(m.all { it in 0..40320 })
    }

    @Test fun convertsACustomAmount() {
        assertEquals(30, toMinutes(30.0, ReminderUnit.Minutes))
        assertEquals(120, toMinutes(2.0, ReminderUnit.Hours))
        assertEquals(4320, toMinutes(3.0, ReminderUnit.Days))
        assertEquals(20160, toMinutes(2.0, ReminderUnit.Weeks))
        assertNull(toMinutes(5.0, ReminderUnit.Weeks)) // over the API's 28-day limit
        assertNull(toMinutes(-1.0, ReminderUnit.Minutes))
        assertEquals(90, toMinutes(1.5, ReminderUnit.Hours))
        assertNull(toMinutes(0.5, ReminderUnit.Minutes)) // not a whole number of minutes
    }

    @Test fun addsWithoutDuplicatesLongestFirstUpToTwenty() {
        assertEquals(listOf(30, 10), addReminder(listOf(30), 10))
        assertEquals(listOf(60, 30, 10), addReminder(listOf(30, 10), 60))
        assertEquals(listOf(30), addReminder(listOf(30), 30))
        val full = List(20) { it * 5 }.sortedDescending()
        assertEquals(full, addReminder(full, 1))
    }

    @Test fun readableMessagesForEveryErrorTheApiDocuments() {
        fun e(status: Int, code: String) = errorMessage(ApiException(status, code, "server text"), TestMessages)
        assertEquals("Can't reach the server. Check your connection and try again.", errorMessage(NetworkException("down"), TestMessages))
        assertEquals("This event was changed somewhere else. Reload to see the latest.", e(412, "version_conflict"))
        assertEquals("That doesn't exist any more, or it isn't yours.", e(404, "not_found"))
        assertEquals("Some of the values aren't valid. Check the form and try again.", e(422, "validation_error"))
        assertEquals("That repeat rule isn't supported.", e(422, "unsupported_rrule"))
        assertEquals("That request was already sent with different details.", e(422, "idempotency_conflict"))
        assertEquals("The server is busy. Try again in a moment.", e(503, "busy"))
        assertEquals("Your sign-in ended. Sign in again.", e(401, "unauthorized"))
        assertEquals("The server hit an error. Try again.", e(500, "internal"))
        assertEquals("Something went wrong. Try again.", e(418, "no_such_code"))
        assertEquals("Something went wrong. Try again.", errorMessage(IllegalStateException("x"), TestMessages))
    }
}

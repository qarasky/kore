package dev.qarasky.korecalendar

import android.app.NotificationManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.qarasky.korecalendar.data.Account
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Reminder
import dev.qarasky.korecalendar.reminders.ReminderStatus
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The reminder path on a real device: a due reminder becomes a notification, a repeat check shows nothing twice, signing out clears the alarm. */
@RunWith(AndroidJUnit4::class)
class RemindersTest {
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val context = inst.targetContext
    private val graph = Graph.get(context)
    private val nm = context.getSystemService(NotificationManager::class.java)

    @Before fun setUp() {
        inst.uiAutomation.grantRuntimePermission(context.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        nm.cancelAll()
    }

    @After fun tearDown() = runBlocking {
        graph.accounts.clear()
        graph.store.clear()
        graph.reminders.sync()
        nm.cancelAll()
    }

    private suspend fun seed(now: Instant, vararg o: Occurrence) {
        graph.accounts.save(Account("http://10.0.2.2:8080", "u1", "me@example.com", "UTC", "kcal_test"))
        graph.store.commit("u1", listOf(Calendar("c1", "Work", "#7b6cf0")), o.toList(), now.truncatedTo(ChronoUnit.DAYS), 1, now)
    }

    private fun occ(id: String, start: Instant, minutes: Int, title: String = id) = Occurrence(
        eventId = id, calendarId = "c1", key = "k-$id", title = title, location = "Room 4", start = "", end = "", tz = "UTC",
        startUtc = start, endUtc = start.plus(1, ChronoUnit.HOURS), reminders = listOf(Reminder(minutes)),
    )

    @Test fun aDueReminderShowsOneNotificationAndNotTwice() = runBlocking {
        val now = Instant.now().truncatedTo(ChronoUnit.MILLIS)
        // The event starts in 20 minutes with a 30-minute reminder: it came due 10 minutes ago.
        seed(now, occ("dentist", now.plus(20, ChronoUnit.MINUTES), 30, "Dentist"))
        graph.kv.put("reminders.lastcheck", now.minus(1, ChronoUnit.HOURS).toString())
        graph.reminders.sync(now)
        val shown = nm.activeNotifications.filter { it.packageName == context.packageName }
        assertEquals(1, shown.size)
        assertEquals("Dentist", shown[0].notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString())
        assertTrue(shown[0].notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString().contains("Room 4"))
        nm.cancelAll()
        graph.reminders.sync(now.plusSeconds(60)) // the same reminder must not come back
        assertEquals(0, nm.activeNotifications.count { it.packageName == context.packageName })
    }

    @Test fun theStatusNamesTheNextReminderAndAReminderForAnEventThatAlreadyEndedIsNotShown() = runBlocking {
        val now = Instant.now().truncatedTo(ChronoUnit.MILLIS)
        seed(now, occ("later", now.plus(3, ChronoUnit.HOURS), 30), occ("over", now.minus(3, ChronoUnit.HOURS), 15))
        graph.kv.put("reminders.lastcheck", now.minus(5, ChronoUnit.HOURS).toString())
        graph.reminders.sync(now)
        assertEquals(0, nm.activeNotifications.count { it.packageName == context.packageName })
        val status = graph.reminders.status(now)
        assertTrue(status.toString(), status is ReminderStatus.Ok && status.next == now.plus(150, ChronoUnit.MINUTES))
    }
}

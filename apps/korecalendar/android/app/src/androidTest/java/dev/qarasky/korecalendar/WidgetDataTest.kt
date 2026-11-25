package dev.qarasky.korecalendar

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.qarasky.korecalendar.agenda.widgetModel
import dev.qarasky.korecalendar.data.Account
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.widget.WidgetUpdater
import dev.qarasky.korecalendar.widget.loadWidgetData
import dev.qarasky.korecalendar.widget.rowsFor
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The widget's data path on a real device: the app's own store and account, and the redraw call. */
@RunWith(AndroidJUnit4::class)
class WidgetDataTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val graph = Graph.get(context)

    @After fun tearDown() = runBlocking {
        graph.accounts.clear()
        graph.store.clear()
    }

    @Test fun fiveUpcomingEventsGiveThreeRowsAtTheDefaultSizeAndTheRedrawSucceeds() = runBlocking {
        val now = Instant.now().truncatedTo(ChronoUnit.MILLIS) // the store keeps milliseconds
        val base = now.plus(1, ChronoUnit.HOURS)
        val events = (0 until 5).map { i ->
            Occurrence(
                eventId = "e$i", calendarId = "c1", key = "k$i", title = "Event $i", start = "", end = "", tz = "UTC",
                startUtc = base.plus(i.toLong(), ChronoUnit.HOURS), endUtc = base.plus(i.toLong(), ChronoUnit.HOURS).plus(30, ChronoUnit.MINUTES),
            )
        }
        graph.accounts.save(Account("http://10.0.2.2:8080", "u1", "me@example.com", "UTC", "kcal_test"))
        graph.store.commit("u1", listOf(Calendar("c1", "Work", "#7b6cf0")), events, now.truncatedTo(ChronoUnit.DAYS), 1, now)

        val data = loadWidgetData(context)
        assertTrue(data.signedIn)
        val snap = data.snapshot!!
        assertEquals(5, snap.occurrences.size)
        val model = widgetModel(snap.occurrences, snap.calendars, data.hidden, data.zone, now, snap.lastSyncAt, rowsFor(110f))
        assertEquals(3, model.rowCount)
        assertEquals(events[0].endUtc, model.nextTick)

        WidgetUpdater.updateAll(context) // must complete without throwing, with no widget placed
    }
}

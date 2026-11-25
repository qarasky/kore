package dev.qarasky.korecalendar

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.qarasky.korecalendar.data.AppDatabase
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Reminder
import dev.qarasky.korecalendar.data.RoomStore
import java.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomStoreTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dbName = "room-store-test.db"
    private var db: AppDatabase = open()

    private fun open() = Room.databaseBuilder(context, AppDatabase::class.java, dbName).build()

    @After fun tearDown() {
        db.close()
        context.deleteDatabase(dbName)
    }

    private fun occ(id: String, start: String) = Occurrence(
        eventId = id, calendarId = "c1", key = start, title = "T $id", notes = "n", location = "l", start = start, end = start, tz = "Europe/Berlin",
        allDay = false, isRecurring = true, isOverride = true, startUtc = Instant.parse("2026-11-05T09:00:00Z"), endUtc = Instant.parse("2026-11-05T10:00:00Z"),
        reminders = listOf(Reminder(30), Reminder(5)),
    )

    private val cals = listOf(Calendar("c2", "Home", "#4caf50"), Calendar("c1", "Work", "#7b6cf0"))
    private val synced = Instant.parse("2026-11-04T10:00:00Z")
    private val window = Instant.parse("2026-10-21T00:00:00Z")

    @Test fun commitThenSnapshotRoundTrips() = runBlocking {
        val store = RoomStore(db)
        store.commit("u1", cals, listOf(occ("e1", "2026-11-05T10:00:00")), window, 42, synced)
        val s = store.snapshot()
        assertEquals(cals, s.calendars) // creation order kept
        assertEquals(listOf(occ("e1", "2026-11-05T10:00:00")), s.occurrences)
        assertEquals(synced, s.lastSyncAt)
        assertEquals("u1", s.accountId)
        assertEquals(42L, store.cursor())
        assertEquals(window, store.windowFrom())
    }

    @Test fun aCommitWithoutOccurrencesKeepsTheStoredOnes() = runBlocking {
        val store = RoomStore(db)
        store.commit("u1", cals, listOf(occ("e1", "2026-11-05T10:00:00")), window, 1, synced)
        store.commit("u1", cals.take(1), null, null, 2, synced.plusSeconds(60))
        val s = store.snapshot()
        assertEquals(1, s.occurrences.size)
        assertEquals(1, s.calendars.size)
        assertEquals(window, store.windowFrom())
        assertEquals(2L, store.cursor())
    }

    @Test fun aCommitThatFailsHalfWayChangesNothing() = runBlocking {
        val store = RoomStore(db)
        store.commit("u1", cals, listOf(occ("e1", "2026-11-05T10:00:00")), window, 1, synced)
        val before = store.snapshot()
        val exploding = object : AbstractList<Occurrence>() {
            override val size = 2
            override fun get(index: Int): Occurrence = if (index == 0) occ("x", "2026-11-06T10:00:00") else throw IllegalStateException("boom")
        }
        assertThrows(IllegalStateException::class.java) {
            runBlocking { store.commit("u2", emptyList(), exploding, window.plusSeconds(86400), 9, synced.plusSeconds(1)) }
        }
        assertEquals(before, store.snapshot())
        assertEquals(1L, store.cursor())
        assertEquals(window, store.windowFrom())
    }

    @Test fun clearEmptiesEverything() = runBlocking {
        val store = RoomStore(db)
        store.commit("u1", cals, listOf(occ("e1", "2026-11-05T10:00:00")), window, 5, synced)
        store.clear()
        val s = store.snapshot()
        assertTrue(s.calendars.isEmpty() && s.occurrences.isEmpty())
        assertNull(s.lastSyncAt)
        assertNull(s.accountId)
        assertEquals(0L, store.cursor())
        assertNull(store.windowFrom())
    }

    @Test fun theCopySurvivesReopeningTheDatabase() = runBlocking {
        RoomStore(db).commit("u1", cals, listOf(occ("e1", "2026-11-05T10:00:00")), window, 7, synced)
        db.close()
        db = open()
        val store = RoomStore(db)
        assertEquals(7L, store.cursor())
        assertEquals(window, store.windowFrom())
        assertEquals(1, store.snapshot().occurrences.size)
    }
}

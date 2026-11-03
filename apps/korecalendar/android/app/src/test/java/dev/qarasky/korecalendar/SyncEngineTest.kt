package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.ChangeSet
import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.sync.SyncEngine
import dev.qarasky.korecalendar.sync.SyncResult
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncEngineTest {
    private val cal = Calendar("c1", "Work", "#7b6cf0")
    private var clock = Instant.parse("2026-11-04T10:00:00Z")
    private val api = FakeApi()
    private val store = FakeStore()
    private fun engine(account: String = "u1") = SyncEngine(api, store, account) { clock }

    private fun occ(id: String, startUtc: String) = Occurrence(
        eventId = id, calendarId = "c1", key = startUtc, title = id, start = startUtc, end = startUtc, tz = "UTC",
        startUtc = Instant.parse(startUtc), endUtc = Instant.parse(startUtc).plusSeconds(3600),
    )

    private fun event(id: String) = Event(id = id, calendarId = "c1", version = 1)

    private fun script(occurrences: (Instant, Instant) -> List<Occurrence> = { _, _ -> emptyList() }, changes: (Long) -> ChangeSet = { ChangeSet(cursor = 5) }) {
        api.onCalendars = { listOf(cal) }
        api.onOccurrences = occurrences
        api.onChanges = changes
    }

    @Test fun firstSyncStoresCalendarsOccurrencesCursorAndTime() = runTest {
        script(
            occurrences = { from, _ -> listOf(occ("e-" + from.toString().take(10), from.plusSeconds(3600).toString())) },
            changes = { ChangeSet(cursor = 9, upserted = listOf(event("e1"))) },
        )
        val r = engine().sync()
        assertTrue(r is SyncResult.Ok)
        val snap = store.snapshot()
        assertEquals(listOf(cal), snap.calendars)
        assertEquals(3, snap.occurrences.size)
        assertEquals(clock, snap.lastSyncAt)
        assertEquals("u1", snap.accountId)
        assertEquals(9L, store.cursor())
        // The window is 14 days back to 60 days ahead, day-aligned in UTC, fetched in chunks of at most 30 days.
        val from = Instant.parse("2026-10-21T00:00:00Z")
        assertEquals(from, store.windowFrom())
        assertEquals(3, api.occurrenceRequests.size)
        assertEquals(from, api.occurrenceRequests.first().first)
        assertEquals(Instant.parse("2027-01-03T00:00:00Z"), api.occurrenceRequests.last().second)
        api.occurrenceRequests.zipWithNext().forEach { (a, b) -> assertEquals(a.second, b.first) }
        api.occurrenceRequests.forEach { (f, t) -> assertTrue(Duration.between(f, t) <= Duration.ofDays(30)) }
    }

    @Test fun aSecondSyncWithNothingNewAsksForNoOccurrences() = runTest {
        script()
        engine().sync()
        api.occurrenceRequests.clear()
        clock = clock.plusSeconds(900)
        val r = engine().sync()
        assertEquals(SyncResult.Ok(changed = false), r)
        assertTrue(api.occurrenceRequests.isEmpty())
        assertEquals(clock, store.snapshot().lastSyncAt)
        assertEquals(listOf(0L, 5L), api.changeRequests)
    }

    @Test fun aChangeRefetchesAndADeletionDropsTheEventsOccurrences() = runTest {
        script(occurrences = { from, _ -> if (from == Instant.parse("2026-10-21T00:00:00Z")) listOf(occ("e1", "2026-11-05T09:00:00Z"), occ("e2", "2026-11-06T09:00:00Z")) else emptyList() })
        engine().sync()
        assertEquals(2, store.snapshot().occurrences.size)
        api.onChanges = { ChangeSet(cursor = 8, deleted = listOf("e1")) }
        api.onOccurrences = { from, _ -> if (from == Instant.parse("2026-10-21T00:00:00Z")) listOf(occ("e2", "2026-11-06T09:00:00Z")) else emptyList() }
        clock = clock.plusSeconds(60)
        val r = engine().sync()
        assertEquals(SyncResult.Ok(changed = true), r)
        assertEquals(listOf("e2"), store.snapshot().occurrences.map { it.eventId })
        assertEquals(8L, store.cursor())
    }

    @Test fun morePagesAreFollowedAndTheLastCursorIsKept() = runTest {
        script(changes = { since -> if (since < 2) ChangeSet(cursor = since + 1, upserted = listOf(event("e$since")), more = true) else ChangeSet(cursor = 2, more = false) })
        engine().sync()
        assertEquals(listOf(0L, 1L, 2L), api.changeRequests)
        assertEquals(2L, store.cursor())
    }

    @Test fun theWindowMovesAtTheNextUtcDay() = runTest {
        script()
        engine().sync()
        api.occurrenceRequests.clear()
        clock = Instant.parse("2026-11-04T23:59:00Z") // same UTC day
        engine().sync()
        assertTrue(api.occurrenceRequests.isEmpty())
        clock = Instant.parse("2026-11-05T00:01:00Z") // next UTC day
        engine().sync()
        assertEquals(3, api.occurrenceRequests.size)
        assertEquals(Instant.parse("2026-10-22T00:00:00Z"), store.windowFrom())
    }

    @Test fun aSyncThatFailsHalfWayChangesNothing() = runTest {
        script(changes = { ChangeSet(cursor = 5, upserted = listOf(event("e1"))) })
        engine().sync()
        val before = store.dump()
        clock = clock.plusSeconds(600)

        // The network drops on the third chunk.
        api.occurrenceRequests.clear()
        script(occurrences = { from, _ -> if (api.occurrenceRequests.size >= 3) throw NetworkException("dropped") else listOf(occ("x" + api.occurrenceRequests.size, from.toString())) },
            changes = { ChangeSet(cursor = 9, upserted = listOf(event("e2"))) })
        assertEquals(SyncResult.Offline, engine().sync())
        assertEquals(before, store.dump())

        // A server error on the changes call.
        api.onChanges = { throw ApiException(500, "internal", "boom") }
        assertTrue(engine().sync() is SyncResult.Failed)
        assertEquals(before, store.dump())

        // calendars() failing.
        api.onChanges = { ChangeSet(cursor = 9, upserted = listOf(event("e2"))) }
        api.onCalendars = { throw NetworkException("no route") }
        assertEquals(SyncResult.Offline, engine().sync())
        assertEquals(before, store.dump())

        // The next good sync still sees the same changes (the cursor never moved) and succeeds.
        api.onCalendars = { listOf(cal) }
        api.onOccurrences = { from, _ -> listOf(occ("fresh" + from.toString().take(10), from.toString())) }
        api.changeRequests.clear()
        assertEquals(SyncResult.Ok(changed = true), engine().sync())
        assertEquals(listOf(5L), api.changeRequests)
        assertEquals(9L, store.cursor())
    }

    @Test fun aRevokedTokenIsReportedAndTheCopyStaysReadable() = runTest {
        script(occurrences = { from, _ -> if (from == Instant.parse("2026-10-21T00:00:00Z")) listOf(occ("e1", "2026-11-05T09:00:00Z")) else emptyList() })
        engine().sync()
        val before = store.dump()
        api.onChanges = { throw ApiException(401, "unauthorized", "Sign in.") }
        assertEquals(SyncResult.SignedOut, engine().sync())
        assertEquals(before, store.dump())
        assertEquals(1, store.snapshot().occurrences.size)
    }

    @Test fun aProxysOwn401IsNotARevokedToken() = runTest {
        script(occurrences = { from, _ -> if (from == Instant.parse("2026-10-21T00:00:00Z")) listOf(occ("e1", "2026-11-05T09:00:00Z")) else emptyList() })
        engine().sync()
        val before = store.dump()
        // A reverse proxy (or a captive portal) answering 401 with its own page is not the API saying "unauthorized".
        api.onChanges = { throw ApiException(401, "bad_response", "Unexpected answer from the server (HTTP 401).") }
        val r = engine().sync()
        assertTrue("got $r", r is SyncResult.Failed)
        assertEquals(before, store.dump())
    }

    @Test fun anotherAccountEmptiesTheCopyFirst() = runTest {
        script(occurrences = { _, _ -> listOf(occ("e1", "2026-11-05T09:00:00Z")) })
        engine("u1").sync()
        // A failing sync for the other account must not leave the first account's events behind or half-fill.
        api.onCalendars = { throw NetworkException("down") }
        assertEquals(SyncResult.Offline, engine("u2").sync())
        assertTrue(store.snapshot().occurrences.isEmpty())
        assertNull(store.snapshot().accountId)
        // And when it works, only the new account's data is there.
        api.onCalendars = { listOf(cal) }
        api.onOccurrences = { _, _ -> listOf(occ("other", "2026-11-05T10:00:00Z")) }
        engine("u2").sync()
        assertEquals("u2", store.snapshot().accountId)
        assertTrue(store.snapshot().occurrences.all { it.eventId == "other" })
    }

    @Test fun anEmptyServerIsStoredAsSyncedNotAsNever() = runTest {
        script()
        engine().sync()
        assertNotNull(store.snapshot().lastSyncAt)
        assertTrue(store.snapshot().occurrences.isEmpty())
    }
}

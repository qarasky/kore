package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Snapshot
import dev.qarasky.korecalendar.ui.SyncState
import dev.qarasky.korecalendar.ui.agendaUi
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UiModelsTest {
    private val zone = ZoneId.of("Europe/Berlin")
    private val now = Instant.parse("2026-11-04T12:00:00Z")
    private val cals = listOf(Calendar("c1", "Work", "#7b6cf0"), Calendar("c2", "Home", "#4caf50"))

    private fun occ(id: String, start: String, end: String, cal: String = "c1") = Occurrence(
        eventId = id, calendarId = cal, key = start, title = id, start = start, end = end, tz = "UTC",
        startUtc = Instant.parse(start), endUtc = Instant.parse(end),
    )

    private fun snap(vararg o: Occurrence, syncedAt: String? = "2026-11-04T11:50:00Z") =
        Snapshot(cals, o.toList(), syncedAt?.let(Instant::parse), "u1")

    private val past = occ("past", "2026-11-04T07:00:00Z", "2026-11-04T08:00:00Z")
    private val soon = occ("soon", "2026-11-04T13:00:00Z", "2026-11-04T14:00:00Z")

    @Test fun aFreshCopyHasNoStaleNote() {
        val ui = agendaUi(snap(soon), emptySet(), zone, now, SyncState.Idle)
        assertNull(ui.staleHours)
        assertFalse(ui.offline)
        assertFalse(ui.neverSynced)
    }

    @Test fun anOldCopySaysHowOld() {
        val ui = agendaUi(snap(soon, syncedAt = "2026-11-04T07:00:00Z"), emptySet(), zone, now, SyncState.Idle)
        assertEquals(5L, ui.staleHours)
    }

    @Test fun neverSyncedIsFlagged() {
        assertTrue(agendaUi(snap(syncedAt = null), emptySet(), zone, now, SyncState.Idle).neverSynced)
    }

    @Test fun offlineIsShown() {
        assertTrue(agendaUi(snap(soon), emptySet(), zone, now, SyncState.Offline).offline)
    }

    @Test fun endedEventsOfTodayStayButAreMarked() {
        val rows = agendaUi(snap(past, soon), emptySet(), zone, now, SyncState.Idle).days.single().rows
        assertEquals(listOf("past", "soon"), rows.map { it.item.occ.eventId })
        assertEquals(listOf(true, false), rows.map { it.ended })
    }

    @Test fun hiddenCalendarsAreRemoved() {
        val ui = agendaUi(snap(soon, occ("home", "2026-11-04T15:00:00Z", "2026-11-04T16:00:00Z", "c2")), setOf("c2"), zone, now, SyncState.Idle)
        assertEquals(listOf("soon"), ui.days.single().rows.map { it.item.occ.eventId })
    }

    @Test fun emptyWhenNothingUpcomingOrEverythingIsHidden() {
        assertTrue(agendaUi(snap(), emptySet(), zone, now, SyncState.Idle).empty)
        assertTrue(agendaUi(snap(past), emptySet(), zone, now, SyncState.Idle).empty) // only ended events today
        assertTrue(agendaUi(snap(soon), setOf("c1"), zone, now, SyncState.Idle).empty)
        assertFalse(agendaUi(snap(soon), emptySet(), zone, now, SyncState.Idle).empty)
    }
}

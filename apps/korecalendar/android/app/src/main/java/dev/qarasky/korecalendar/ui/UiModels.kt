package dev.qarasky.korecalendar.ui

import dev.qarasky.korecalendar.agenda.AgendaItem
import dev.qarasky.korecalendar.agenda.buildAgenda
import dev.qarasky.korecalendar.agenda.staleHours
import dev.qarasky.korecalendar.data.Snapshot
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

sealed interface SyncState {
    data object Idle : SyncState
    data object Syncing : SyncState
    data object Offline : SyncState
    data object SignedOut : SyncState
    data class Failed(val message: String) : SyncState
}

data class AgendaRowUi(val item: AgendaItem, val ended: Boolean)
data class AgendaDayUi(val date: LocalDate, val rows: List<AgendaRowUi>)

data class AgendaUi(
    val days: List<AgendaDayUi>,
    val today: LocalDate,
    val offline: Boolean,
    /** Whole hours since the last sync, only when that is over three hours ago. */
    val staleHours: Long?,
    val neverSynced: Boolean,
    /** Nothing visible is coming up (ended events of today may still be listed above it). */
    val empty: Boolean,
)

/** What the Agenda screen shows for [snapshot]: today on, ended events of today dimmed, hidden calendars removed. */
fun agendaUi(snapshot: Snapshot, hidden: Set<String>, zone: ZoneId, now: Instant, syncState: SyncState): AgendaUi {
    val all = buildAgenda(snapshot.occurrences, snapshot.calendars, hidden, zone, now, onlyUpcoming = false)
    val upcoming = buildAgenda(snapshot.occurrences, snapshot.calendars, hidden, zone, now, onlyUpcoming = true)
    return AgendaUi(
        days = all.map { d -> AgendaDayUi(d.date, d.items.map { AgendaRowUi(it, ended = !it.endInstant.isAfter(now)) }) },
        today = now.atZone(zone).toLocalDate(),
        offline = syncState is SyncState.Offline,
        staleHours = staleHours(snapshot.lastSyncAt, now),
        neverSynced = snapshot.lastSyncAt == null,
        empty = upcoming.isEmpty(),
    )
}

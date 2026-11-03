package dev.qarasky.korecalendar.sync

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.LocalStore
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Occurrence
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit

sealed interface SyncResult {
    data class Ok(val changed: Boolean) : SyncResult
    data object SignedOut : SyncResult
    data object Offline : SyncResult
    data class Failed(val code: String, val message: String) : SyncResult
}

/** The window of occurrences kept on the phone: 14 days back, 60 days ahead, fetched in 30-day chunks. */
private val BACK: Duration = Duration.ofDays(14)
private val SPAN: Duration = Duration.ofDays(74)
private val CHUNK: Duration = Duration.ofDays(30)

/**
 * Brings the local copy up to date. Everything is fetched first and written with one
 * [LocalStore.commit] at the end, so a sync that fails half-way changes nothing, and the change
 * cursor only moves together with the occurrences it is about.
 */
class SyncEngine(
    private val api: CalendarApi,
    private val store: LocalStore,
    private val accountId: String,
    private val now: () -> Instant,
) {
    suspend fun sync(): SyncResult {
        val started = now()
        try {
            val known = store.snapshot().accountId
            if (known != null && known != accountId) store.clear()

            val calendars = api.calendars()

            var cursor = store.cursor()
            var changed = false
            do {
                val page = api.changes(cursor)
                changed = changed || page.upserted.isNotEmpty() || page.deleted.isNotEmpty()
                cursor = page.cursor
            } while (page.more)

            val from = started.minus(BACK).truncatedTo(ChronoUnit.DAYS)
            val neverSynced = store.snapshot().lastSyncAt == null
            val refetch = changed || neverSynced || store.windowFrom() != from
            val occurrences = if (refetch) fetchWindow(from) else null

            store.commit(accountId, calendars, occurrences, from, cursor, started)
            return SyncResult.Ok(changed = refetch)
        } catch (e: ApiException) {
            // Only the API's own answer means the token is gone: a proxy or portal with a 401 page of its own does not.
            return if (e.status == 401 && e.code == "unauthorized") SyncResult.SignedOut else SyncResult.Failed(e.code, e.message ?: "")
        } catch (e: NetworkException) {
            return SyncResult.Offline
        }
    }

    private suspend fun fetchWindow(from: Instant): List<Occurrence> {
        val end = from.plus(SPAN)
        val all = ArrayList<Occurrence>()
        var start = from
        while (start < end) {
            val stop = minOf(start.plus(CHUNK), end)
            all += api.occurrences(start, stop)
            start = stop
        }
        return all
    }
}

package dev.qarasky.korecalendar.data

import java.time.Instant

/** Everything the phone keeps: read by the screens and the widget, written only by a sync. */
data class Snapshot(
    val calendars: List<Calendar>,
    val occurrences: List<Occurrence>,
    val lastSyncAt: Instant?,
    val accountId: String?,
)

interface LocalStore {
    suspend fun snapshot(): Snapshot

    /** The change-feed position: 0 before the first sync. */
    suspend fun cursor(): Long

    /** The start of the window the stored occurrences cover, or null before the first sync. */
    suspend fun windowFrom(): Instant?

    /**
     * Stores a finished sync in one atomic step: either all of it lands or none of it.
     * [occurrences] null keeps the stored occurrences and window; otherwise they replace them.
     */
    suspend fun commit(
        accountId: String,
        calendars: List<Calendar>,
        occurrences: List<Occurrence>?,
        windowFrom: Instant?,
        cursor: Long,
        syncedAt: Instant,
    )

    suspend fun clear()
}

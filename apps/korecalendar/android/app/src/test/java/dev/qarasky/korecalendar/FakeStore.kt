package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.LocalStore
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Snapshot
import java.time.Instant

/** An in-memory [LocalStore]. `commit` swaps everything in one step, like the real one's transaction. */
class FakeStore : LocalStore {
    private data class State(
        val calendars: List<Calendar> = emptyList(),
        val occurrences: List<Occurrence> = emptyList(),
        val lastSyncAt: Instant? = null,
        val accountId: String? = null,
        val cursor: Long = 0,
        val windowFrom: Instant? = null,
    )

    private var state = State()
    var commits = 0
        private set

    override suspend fun snapshot() = Snapshot(state.calendars, state.occurrences, state.lastSyncAt, state.accountId)
    override suspend fun cursor() = state.cursor
    override suspend fun windowFrom() = state.windowFrom

    override suspend fun commit(
        accountId: String,
        calendars: List<Calendar>,
        occurrences: List<Occurrence>?,
        windowFrom: Instant?,
        cursor: Long,
        syncedAt: Instant,
    ) {
        commits++
        state = if (occurrences != null) {
            State(calendars, occurrences, syncedAt, accountId, cursor, windowFrom)
        } else {
            state.copy(calendars = calendars, lastSyncAt = syncedAt, accountId = accountId, cursor = cursor)
        }
    }

    override suspend fun clear() {
        state = State()
    }

    /** Everything observable, for "nothing changed" assertions. */
    fun dump(): Any = state
}

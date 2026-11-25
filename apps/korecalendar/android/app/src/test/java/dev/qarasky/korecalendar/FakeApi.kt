package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.ChangeSet
import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.TokenCreated
import dev.qarasky.korecalendar.data.User
import dev.qarasky.korecalendar.data.WriteRequest
import dev.qarasky.korecalendar.data.WriteResult
import java.time.Instant

/** A scriptable [CalendarApi]: set the lambdas, read the call logs. */
class FakeApi : CalendarApi {
    var onCreateToken: (String) -> TokenCreated = { error("createToken not scripted") }
    var onLogout: () -> Unit = {}
    var onMe: () -> User = { error("me not scripted") }
    var onCalendars: () -> List<Calendar> = { emptyList() }
    var onOccurrences: (Instant, Instant) -> List<Occurrence> = { _, _ -> emptyList() }
    var onChanges: (Long) -> ChangeSet = { ChangeSet(cursor = it) }

    var onEvent: (String) -> Event = { error("event not scripted") }
    var onWrite: (WriteRequest) -> WriteResult = { error("write not scripted") }
    var onRestore: (String) -> Event = { error("restore not scripted") }

    /** When set, writes wait for it (to cancel a caller mid-write). */
    var writeGate: kotlinx.coroutines.CompletableDeferred<Unit>? = null

    val calls = mutableListOf<String>()
    val writes = mutableListOf<WriteRequest>()
    val occurrenceRequests = mutableListOf<Pair<Instant, Instant>>()
    val changeRequests = mutableListOf<Long>()

    var onAuthConfig: () -> dev.qarasky.korecalendar.data.AuthConfig = { dev.qarasky.korecalendar.data.AuthConfig() }
    override suspend fun authConfig(): dev.qarasky.korecalendar.data.AuthConfig { calls += "authConfig"; return onAuthConfig() }
    override suspend fun createToken(name: String): TokenCreated { calls += "createToken:$name"; return onCreateToken(name) }
    override suspend fun logout() { calls += "logout"; onLogout() }
    override suspend fun me(): User { calls += "me"; return onMe() }
    override suspend fun calendars(): List<Calendar> { calls += "calendars"; return onCalendars() }
    override suspend fun occurrences(from: Instant, to: Instant, q: String?): List<Occurrence> {
        calls += "occurrences"
        occurrenceRequests += from to to
        return onOccurrences(from, to)
    }
    override suspend fun changes(since: Long): ChangeSet { calls += "changes"; changeRequests += since; return onChanges(since) }
    override suspend fun event(id: String): Event { calls += "event:$id"; return onEvent(id) }
    override suspend fun write(request: WriteRequest): WriteResult { calls += "write"; writes += request; writeGate?.await(); return onWrite(request) }
    override suspend fun restoreEvent(id: String): Event { calls += "restore:$id"; return onRestore(id) }
}

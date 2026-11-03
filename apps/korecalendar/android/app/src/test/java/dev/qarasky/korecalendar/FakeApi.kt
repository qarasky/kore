package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.ChangeSet
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Session
import dev.qarasky.korecalendar.data.TokenCreated
import dev.qarasky.korecalendar.data.User
import java.time.Instant

/** A scriptable [CalendarApi]: set the lambdas, read the call logs. */
class FakeApi : CalendarApi {
    var onLogin: (String, String) -> Session = { _, _ -> error("login not scripted") }
    var onCreateToken: (String) -> TokenCreated = { error("createToken not scripted") }
    var onLogout: () -> Unit = {}
    var onMe: () -> User = { error("me not scripted") }
    var onCalendars: () -> List<Calendar> = { emptyList() }
    var onOccurrences: (Instant, Instant) -> List<Occurrence> = { _, _ -> emptyList() }
    var onChanges: (Long) -> ChangeSet = { ChangeSet(cursor = it) }

    val calls = mutableListOf<String>()
    val occurrenceRequests = mutableListOf<Pair<Instant, Instant>>()
    val changeRequests = mutableListOf<Long>()

    override suspend fun login(email: String, password: String): Session { calls += "login"; return onLogin(email, password) }
    override suspend fun createToken(name: String): TokenCreated { calls += "createToken:$name"; return onCreateToken(name) }
    override suspend fun logout() { calls += "logout"; onLogout() }
    override suspend fun me(): User { calls += "me"; return onMe() }
    override suspend fun calendars(): List<Calendar> { calls += "calendars"; return onCalendars() }
    override suspend fun occurrences(from: Instant, to: Instant): List<Occurrence> {
        calls += "occurrences"
        occurrenceRequests += from to to
        return onOccurrences(from, to)
    }
    override suspend fun changes(since: Long): ChangeSet { calls += "changes"; changeRequests += since; return onChanges(since) }
}

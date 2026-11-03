package dev.qarasky.korecalendar.ui

import dev.qarasky.korecalendar.data.Account
import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.LocalStore
import dev.qarasky.korecalendar.data.Prefs
import dev.qarasky.korecalendar.data.Repository
import dev.qarasky.korecalendar.data.ServerUrl
import dev.qarasky.korecalendar.data.SignIn
import dev.qarasky.korecalendar.data.SignInResult
import dev.qarasky.korecalendar.data.normalizeServerUrl
import dev.qarasky.korecalendar.edit.EventEditor
import dev.qarasky.korecalendar.edit.FormValues
import dev.qarasky.korecalendar.edit.Messages
import dev.qarasky.korecalendar.edit.newFormValues
import dev.qarasky.korecalendar.sync.SyncEngine
import dev.qarasky.korecalendar.sync.SyncResult
import java.time.DateTimeException
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** What the phone does around the app's data: periodic sync and widget redraws. */
interface Background {
    fun scheduleSync()
    fun cancelSync()
    suspend fun refreshWidgets()
}

/** A short message after a write, with the id to bring back when it was a delete. */
data class Notice(val message: String, val undoEventId: String? = null)

data class CalendarChoice(val calendar: Calendar, val hidden: Boolean)

sealed interface AppState {
    data object Loading : AppState

    /** No account, or the server stopped accepting the token ([revoked]); [server] and [email] prefill the form. */
    data class SignedOut(val server: String, val email: String, val revoked: Boolean) : AppState

    data class Ready(
        val agenda: AgendaUi,
        val server: String,
        val email: String,
        val cleartext: Boolean,
        val syncState: SyncState,
        val calendars: List<CalendarChoice>,
        val clock24: Boolean,
        val zone: ZoneId,
    ) : AppState
}

/**
 * The app's state and actions, with no Android in it: the activity's view model holds one and the
 * screens render [state]. A revoked token shows the sign-in form again but keeps the local copy
 * (the widget keeps showing it, with its age) until a sign-in replaces it.
 */
class AppController(
    private val accounts: AccountStore,
    private val prefs: Prefs,
    private val store: LocalStore,
    private val repo: Repository,
    private val signInFlow: SignIn,
    private val apiFor: (ServerUrl, String?) -> CalendarApi,
    private val background: Background,
    private val messages: Messages = Messages { key, _ -> key },
    private val now: () -> Instant,
) {
    private val _state = MutableStateFlow<AppState>(AppState.Loading)
    val state: StateFlow<AppState> = _state

    private val _editor = MutableStateFlow<EventEditor?>(null)

    /** The editor in progress, if any. It lives here so that a rotation or a recreated activity does not lose what was typed. */
    val editor: StateFlow<EventEditor?> = _editor

    private val _notice = MutableStateFlow<Notice?>(null)
    val notice: StateFlow<Notice?> = _notice

    private var syncState: SyncState = SyncState.Idle
    private val mutex = Mutex()

    suspend fun start() {
        repo.refreshFromStore()
        publish()
        // Idempotent: keeps the periodic sync running after an app update or a reboot.
        if (accounts.load() != null && !accounts.isRevoked()) background.scheduleSync()
    }

    suspend fun signIn(rawUrl: String, email: String, password: String): SignInResult {
        val r = signInFlow.signIn(rawUrl, email, password)
        if (r is SignInResult.Ok) {
            background.scheduleSync()
            syncState = SyncState.Idle
            refresh()
        }
        return r
    }

    suspend fun signInWithKoreId(rawUrl: String, browse: suspend (String) -> String): SignInResult {
        val r = signInFlow.signInWithKoreId(rawUrl, browse)
        if (r is SignInResult.Ok) {
            background.scheduleSync()
            syncState = SyncState.Idle
            refresh()
        }
        return r
    }

    suspend fun refresh(): SyncResult? = mutex.withLock {
        val account = accounts.load() ?: return null
        if (accounts.isRevoked()) return null
        syncState = SyncState.Syncing
        publish()
        val server = normalizeServerUrl(account.serverUrl) ?: ServerUrl(account.serverUrl, account.serverUrl.startsWith("http://"))
        val result = SyncEngine(apiFor(server, account.token), store, account.userId, now).sync()
        repo.refreshFromStore()
        syncState = when (result) {
            is SyncResult.Ok -> SyncState.Idle
            SyncResult.Offline -> SyncState.Offline
            SyncResult.SignedOut -> SyncState.SignedOut.also { accounts.markRevoked() }
            is SyncResult.Failed -> SyncState.Failed(result.message)
        }
        publish()
        background.refreshWidgets()
        result
    }

    suspend fun toggleCalendar(id: String) {
        val hidden = prefs.hiddenCalendars
        prefs.hiddenCalendars = if (id in hidden) hidden - id else hidden + id
        publish()
        background.refreshWidgets()
    }

    suspend fun setClock24(value: Boolean) {
        prefs.clock24 = value
        publish()
        background.refreshWidgets()
    }

    suspend fun signOut() {
        _editor.value = null
        _notice.value = null
        background.cancelSync()
        accounts.clear()
        store.clear()
        repo.refreshFromStore()
        syncState = SyncState.Idle
        publish()
        background.refreshWidgets()
    }

    /** An editor for one editing session; a successful write syncs, so the screens and the widget agree. Null when signed out. */
    fun newEditor(): EventEditor? {
        val account = accounts.load() ?: return null
        if (accounts.isRevoked()) return null
        val server = normalizeServerUrl(account.serverUrl) ?: ServerUrl(account.serverUrl, account.serverUrl.startsWith("http://"))
        return EventEditor(apiFor(server, account.token), messages, newKey = { java.util.UUID.randomUUID().toString() }, onWritten = { refresh() })
    }

    /**
     * The form for a new event on [day] (today by default): in the account's zone, in the first visible calendar,
     * at the next full hour when the day is today and at nine otherwise, for an hour. Null when signed out.
     */
    fun newEventForm(day: java.time.LocalDate? = null): FormValues? {
        val account = accounts.load() ?: return null
        val snapshot = repo.snapshot.value ?: return null
        val zone = zoneOf(account.timezone)
        val hidden = prefs.hiddenCalendars
        val calendarId = (snapshot.calendars.firstOrNull { it.id !in hidden } ?: snapshot.calendars.firstOrNull())?.id ?: ""
        val local = now().atZone(zone)
        val target = day ?: local.toLocalDate()
        val time = if (target == local.toLocalDate()) local.toLocalTime().truncatedTo(java.time.temporal.ChronoUnit.HOURS).plusHours(1) else java.time.LocalTime.of(9, 0)
        // The next hour wraps past midnight: it is tomorrow at 00:00 (as on the web), not a time that is already past.
        val wraps = target == local.toLocalDate() && time < local.toLocalTime()
        return newFormValues(if (wraps) target.plusDays(1) else target, time, 60, false, zone.id, calendarId)
    }

    /** Opens the editor on a new event on [day] (today by default). */
    fun beginNew(day: java.time.LocalDate? = null) {
        val form = newEventForm(day) ?: return
        val e = newEditor() ?: return
        e.openNew(form)
        _editor.value = e
    }

    /** Opens the editor on the event [occ] belongs to; the editor shows a loading state until the server has answered. */
    suspend fun beginEdit(occ: dev.qarasky.korecalendar.data.Occurrence) {
        val e = newEditor() ?: return
        _editor.value = e
        e.openExisting(occ)
    }

    fun endEdit() {
        _editor.value?.close()
        _editor.value = null
    }

    suspend fun save(scope: dev.qarasky.korecalendar.edit.Scope): dev.qarasky.korecalendar.edit.SaveResult {
        val e = _editor.value ?: return dev.qarasky.korecalendar.edit.SaveResult.Failed
        val r = e.save(scope)
        // Only close the editor this save belonged to: the person may have cancelled and opened another meanwhile.
        when (r) {
            is dev.qarasky.korecalendar.edit.SaveResult.Saved -> { if (_editor.value === e) _editor.value = null; _notice.value = Notice(r.message) }
            dev.qarasky.korecalendar.edit.SaveResult.Unchanged -> if (_editor.value === e) _editor.value = null
            else -> Unit
        }
        return r
    }

    suspend fun delete(occ: dev.qarasky.korecalendar.data.Occurrence, scope: dev.qarasky.korecalendar.edit.Scope) {
        val e = newEditor() ?: return
        _notice.value = when (val r = e.delete(occ, scope)) {
            is dev.qarasky.korecalendar.edit.DeleteResult.Deleted -> Notice(r.message, if (r.undoable) r.eventId else null)
            is dev.qarasky.korecalendar.edit.DeleteResult.Failed -> Notice(r.message)
        }
    }

    suspend fun undoDelete(eventId: String) {
        val e = newEditor() ?: return
        _notice.value = Notice(e.undo(eventId))
    }

    fun dismissNotice() {
        _notice.value = null
    }

    /** Called about once a minute while the screen is open: "now" moved, so ended events and "today" may have changed. */
    fun tick() = publish()

    private fun publish() {
        val account = accounts.load()
        val snapshot = repo.snapshot.value
        _state.value = when {
            account == null -> AppState.SignedOut("", "", revoked = false)
            accounts.isRevoked() -> AppState.SignedOut(account.serverUrl, account.email, revoked = true)
            snapshot == null -> AppState.Loading
            else -> ready(account, snapshot)
        }
    }

    private fun zoneOf(id: String): ZoneId = try {
        ZoneId.of(id)
    } catch (_: DateTimeException) {
        ZoneId.of("UTC")
    }

    private fun ready(account: Account, snapshot: dev.qarasky.korecalendar.data.Snapshot): AppState.Ready {
        val zone = try {
            ZoneId.of(account.timezone)
        } catch (_: DateTimeException) {
            ZoneId.of("UTC")
        }
        val hidden = prefs.hiddenCalendars
        return AppState.Ready(
            agenda = agendaUi(snapshot, hidden, zone, now(), syncState),
            server = account.serverUrl,
            email = account.email,
            cleartext = account.serverUrl.startsWith("http://"),
            syncState = syncState,
            calendars = snapshot.calendars.map { CalendarChoice(it, it.id in hidden) },
            clock24 = prefs.clock24,
            zone = zone,
        )
    }
}

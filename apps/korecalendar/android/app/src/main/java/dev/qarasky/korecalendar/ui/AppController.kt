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
    private val now: () -> Instant,
) {
    private val _state = MutableStateFlow<AppState>(AppState.Loading)
    val state: StateFlow<AppState> = _state

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
        background.cancelSync()
        accounts.clear()
        store.clear()
        repo.refreshFromStore()
        syncState = SyncState.Idle
        publish()
        background.refreshWidgets()
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

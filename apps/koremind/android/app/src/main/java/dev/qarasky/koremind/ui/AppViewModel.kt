package dev.qarasky.koremind.ui

import android.app.Application
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.qarasky.koremind.data.ApiException
import dev.qarasky.koremind.ui.chat.PendingFile
import dev.qarasky.koremind.ui.chat.UploadState
import dev.qarasky.koremind.ui.chat.addUploading
import dev.qarasky.koremind.ui.chat.markFailed
import dev.qarasky.koremind.ui.chat.markReady
import dev.qarasky.koremind.ui.chat.readyAttachments
import dev.qarasky.koremind.ui.chat.removePending as removePendingFile
import dev.qarasky.koremind.ui.chat.retrying
import dev.qarasky.koremind.ui.chat.uploadingCount
import dev.qarasky.koremind.data.Health
import dev.qarasky.koremind.data.Pkce
import dev.qarasky.koremind.data.parseSsoLink
import dev.qarasky.koremind.data.SsoAction
import dev.qarasky.koremind.data.User
import dev.qarasky.koremind.data.logoutBrowserUrl
import dev.qarasky.koremind.data.ssoAction
import dev.qarasky.koremind.data.ssoErrorMessage
import dev.qarasky.koremind.data.PairResult
import dev.qarasky.koremind.data.pair
import dev.qarasky.koremind.data.parsePairLink
import dev.qarasky.koremind.data.Attachment
import dev.qarasky.koremind.data.Cache
import dev.qarasky.koremind.data.ChatSummary
import dev.qarasky.koremind.data.ModelRef
import dev.qarasky.koremind.data.Prefs
import dev.qarasky.koremind.data.ProviderInfo
import dev.qarasky.koremind.data.SendMessageRequest
import dev.qarasky.koremind.data.StreamEvent
import dev.qarasky.koremind.data.KoreMindApi
import dev.qarasky.koremind.data.normalizeBackendUrl
import dev.qarasky.koremind.data.uploadSizeError
import dev.qarasky.koremind.data.UpdateEvents
import dev.qarasky.koremind.data.UpdateInfo
import dev.qarasky.koremind.data.Updater
import dev.qarasky.koremind.data.isNewer
import dev.qarasky.koremind.data.updateCheckDue
import dev.qarasky.koremind.ui.chat.ChatUiState
import dev.qarasky.koremind.ui.chat.beginTurn
import dev.qarasky.koremind.ui.chat.beginEdit
import dev.qarasky.koremind.ui.chat.reconnecting
import dev.qarasky.koremind.ui.chat.restartDraft
import dev.qarasky.koremind.ui.chat.withServerMessages
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import dev.qarasky.koremind.ui.chat.dismissApproval
import dev.qarasky.koremind.ui.model.defaultChoice
import dev.qarasky.koremind.ui.model.isChoiceAllowed
import dev.qarasky.koremind.ui.chat.endsTurn
import dev.qarasky.koremind.ui.chat.reduce
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class Session(val baseUrl: String?, val signedIn: Boolean, val email: String?)
data class Choice(val providerId: String, val modelId: String, val thinking: String? = null)

/** Where a QR / deep-link pairing stands. Done is consumed by the app shell, which opens the chat. */
sealed interface PairUi {
    data object Idle : PairUi
    data object Working : PairUi
    data object Done : PairUi
    data class Failed(@androidx.annotation.StringRes val message: Int) : PairUi
}

/** Where an app update stands. Shown as a banner over the chat and in Settings → Account. */
sealed interface UpdateUi {
    data object Off : UpdateUi
    data object Idle : UpdateUi
    data object Checking : UpdateUi
    data object UpToDate : UpdateUi
    data class Available(val info: UpdateInfo) : UpdateUi
    data class Downloading(val info: UpdateInfo, val progress: Float) : UpdateUi
    data class Installing(val info: UpdateInfo) : UpdateUi
    data class Failed(val info: UpdateInfo?, val message: String) : UpdateUi
}

/** The release the banner is about, whatever stage the update is in. */
val UpdateUi.release: UpdateInfo? get() = when (this) {
    is UpdateUi.Available -> info; is UpdateUi.Downloading -> info; is UpdateUi.Installing -> info; is UpdateUi.Failed -> info; else -> null
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    private val cache = Cache(app)

    private val _session = MutableStateFlow(Session(prefs.baseUrl, prefs.token != null, prefs.email))
    val session: StateFlow<Session> = _session.asStateFlow()

    var api: KoreMindApi? = prefs.baseUrl?.let { KoreMindApi(it) { prefs.token } }
        private set

    private val _chats = MutableStateFlow(cache.chats())
    val chats: StateFlow<List<ChatSummary>> = _chats.asStateFlow()
    private val _chat = MutableStateFlow(ChatUiState())
    val chat: StateFlow<ChatUiState> = _chat.asStateFlow()
    private val _chatId = MutableStateFlow<String?>(null)
    val chatId: StateFlow<String?> = _chatId.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _pending = MutableStateFlow<List<PendingFile>>(emptyList())
    val pending: StateFlow<List<PendingFile>> = _pending.asStateFlow()
    private val _uploadError = MutableStateFlow<String?>(null)
    val uploadError: StateFlow<String?> = _uploadError.asStateFlow()

    private val _providers = MutableStateFlow<List<ProviderInfo>>(emptyList())
    val providers: StateFlow<List<ProviderInfo>> = _providers.asStateFlow()
    private val _favorites = MutableStateFlow<Set<String>>(emptySet())
    val favorites: StateFlow<Set<String>> = _favorites.asStateFlow()
    private val _choice = MutableStateFlow(prefs.providerId?.let { p -> prefs.modelId?.let { Choice(p, it, prefs.thinking) } })
    val choice: StateFlow<Choice?> = _choice.asStateFlow()

    private val _pair = MutableStateFlow<PairUi>(PairUi.Idle)
    val pairState: StateFlow<PairUi> = _pair.asStateFlow()

    private var streamJob: Job? = null

    // ---- app updates ---------------------------------------------------------
    private val updater = Updater(app)
    private val _update = MutableStateFlow<UpdateUi>(if (updater.enabled) UpdateUi.Idle else UpdateUi.Off)
    val update: StateFlow<UpdateUi> = _update.asStateFlow()
    private val _dismissedUpdate = MutableStateFlow(prefs.dismissedUpdate)
    val dismissedUpdate: StateFlow<Long> = _dismissedUpdate.asStateFlow()
    val appVersion: String get() = updater.installedVersionName

    init {
        if (_session.value.signedIn) refreshAll()
        updater.cleanUp()
        checkForUpdate(force = false)
        viewModelScope.launch {
            UpdateEvents.failure.collect { msg ->
                if (msg == null) return@collect
                UpdateEvents.failure.value = null
                val info = _update.value.release
                // Cancelled on the confirmation screen: offer it again; anything else is an error.
                _update.value = if (msg.isEmpty() && info != null) UpdateUi.Available(info) else UpdateUi.Failed(info, msg)
            }
        }
    }


    /** Looks for a newer release; on its own only every few hours, always when [force]d from Settings. */
    fun checkForUpdate(force: Boolean) {
        if (!updater.enabled) return
        val now = System.currentTimeMillis()
        if (!force && !updateCheckDue(prefs.lastUpdateCheck, now)) return
        val cur = _update.value
        if (cur is UpdateUi.Checking || cur is UpdateUi.Downloading || cur is UpdateUi.Installing) return
        _update.value = UpdateUi.Checking
        viewModelScope.launch {
            _update.value = try {
                val info = updater.latest()
                prefs.lastUpdateCheck = now
                if (info != null && isNewer(info, updater.installedVersionCode)) UpdateUi.Available(info) else UpdateUi.UpToDate
            } catch (e: Exception) {
                if (force) UpdateUi.Failed(null, e.message ?: "") else UpdateUi.Idle
            }
        }
    }

    /** Downloads the release, checks it and hands it to Android, which asks to confirm when it has to. */
    fun installUpdate() {
        val info = _update.value.release ?: return
        if (_update.value is UpdateUi.Downloading || _update.value is UpdateUi.Installing) return
        viewModelScope.launch {
            try {
                _update.value = UpdateUi.Downloading(info, 0f)
                val file = updater.download(info) { p -> _update.value = UpdateUi.Downloading(info, p) }
                _update.value = UpdateUi.Installing(info)
                updater.install(file)
            } catch (e: Exception) { _update.value = UpdateUi.Failed(info, e.message ?: "") }
        }
    }

    /** Hides the banner for this release; Settings still offers it. */
    fun dismissUpdate() {
        val info = _update.value.release ?: return
        prefs.dismissedUpdate = info.versionCode
        _dismissedUpdate.value = info.versionCode
    }

    // ---- session -----------------------------------------------------------
    /** Checks the server answers, then remembers it. */
    suspend fun connect(input: String): Result<Unit> {
        val url = normalizeBackendUrl(input) ?: return Result.failure(IllegalArgumentException("That doesn't look like an address. Try something like 192.168.1.20:8787."))
        return try {
            KoreMindApi(url) { null }.health()
            prefs.baseUrl = url; prefs.signOut()
            api = KoreMindApi(url) { prefs.token }
            _session.value = Session(url, false, null); _me.value = null
            Result.success(Unit)
        } catch (e: Exception) { Result.failure(e) }
    }

    /** The server's /health (it says whether Kore ID is on), or null when it can't be reached. */
    suspend fun health(): Health? = try { api?.health() } catch (_: Exception) { null }

    // ---- Kore ID ------------------------------------------------------------
    /** The signed-in user as /me reports it (ssoLinked drives Settings → Account). Null until loaded. */
    private val _me = MutableStateFlow<User?>(null)
    val me: StateFlow<User?> = _me.asStateFlow()

    fun refreshMe() { viewModelScope.launch { try { api?.me()?.let { _me.value = it } } catch (_: Exception) { } } }

    /**
     * Starts Kore ID in the browser. Signed out it is a sign-in; signed in, the request carries the bearer token and the backend
     * links Kore ID to this account instead. Returns the URL to open; the result arrives as a koremind://sso link.
     */
    suspend fun ssoStart(): Result<String> = try {
        val a = api ?: error("Not connected")
        val verifier = Pkce.newVerifier()
        val url = a.ssoStart(Pkce.challenge(verifier)).url
        prefs.ssoVerifier = verifier
        Result.success(url)
    } catch (e: Exception) { Result.failure(e) }

    /** Finishes a Kore ID sign-in or link from the koremind://sso link the backend sent the browser to. */
    fun handleSsoLink(text: String) {
        val link = parseSsoLink(text) ?: return
        val verifier = prefs.ssoVerifier
        prefs.ssoVerifier = null
        when (val action = ssoAction(link, _session.value.signedIn)) {
            SsoAction.Ignore -> Unit
            SsoAction.LinkDone -> refreshMe()
            // Errors show in the login screen while signing in, and in a dialog (KoreMindApp) anywhere else.
            is SsoAction.Fail -> _pair.value = PairUi.Failed(ssoErrorMessage(action.code))
            is SsoAction.Exchange -> {
                val a = api
                if (verifier == null || a == null) { _pair.value = PairUi.Failed(dev.qarasky.koremind.R.string.sso_failed); return }
                _pair.value = PairUi.Working
                viewModelScope.launch {
                    try {
                        val r = a.ssoExchange(action.ticket, verifier)
                        prefs.token = r.token; prefs.email = r.user.email
                        _session.value = Session(prefs.baseUrl, true, r.user.email)
                        _me.value = r.user
                        refreshAll()
                        _pair.value = PairUi.Done
                    } catch (_: Exception) { _pair.value = PairUi.Failed(dev.qarasky.koremind.R.string.sso_failed) }
                }
            }
        }
    }

    /**
     * Signs out here at once. The server call runs in the background with the token captured now (the local copy is cleared
     * right away); if the session came from Kore ID, its sign-out page then opens in the browser. Failures never block this.
     */
    fun signOut() {
        val token = prefs.token
        val base = prefs.baseUrl
        if (token != null && base != null) viewModelScope.launch {
            val url = try { logoutBrowserUrl(KoreMindApi(base) { token }.logout()) } catch (_: Exception) { null }
            if (url != null) openInBrowser(url)
        }
        prefs.signOut(); cache.clear(); prefs.ssoVerifier = null
        streamJob?.cancel()
        _chat.value = ChatUiState(); _chatId.value = null; _chats.value = emptyList(); _busy.value = false
        _me.value = null
        _session.value = Session(prefs.baseUrl, false, null)
    }

    private fun openInBrowser(url: String) {
        try {
            getApplication<Application>().startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) { }
    }

    // ---- pairing (scan a QR code shown on the web, or open a koremind://pair link) --------------------
    /** Signs in with a scanned or opened pairing link: the first reachable address redeems the code. */
    fun startPair(text: String) {
        if (_pair.value is PairUi.Working) return
        val link = parsePairLink(text)
        if (link == null) { _pair.value = PairUi.Failed(dev.qarasky.koremind.R.string.pair_invalid); return }
        _pair.value = PairUi.Working
        viewModelScope.launch {
            val r = pair(
                link,
                probe = { url -> try { KoreMindApi(url) { null }.healthQuick(); true } catch (_: Exception) { false } },
                redeem = { url, code -> KoreMindApi(url) { null }.redeemPair(code) },
            )
            when (r) {
                is PairResult.Ok -> {
                    prefs.baseUrl = r.url; prefs.token = r.auth.token; prefs.email = r.auth.user.email
                    api = KoreMindApi(r.url) { prefs.token }
                    cache.clear()
                    streamJob?.cancel()
                    _chat.value = ChatUiState(); _chatId.value = null; _chats.value = emptyList(); _busy.value = false
                    _session.value = Session(r.url, true, r.auth.user.email)
                    refreshAll()
                    _pair.value = PairUi.Done
                }
                PairResult.Invalid -> _pair.value = PairUi.Failed(dev.qarasky.koremind.R.string.pair_invalid)
                PairResult.Unreachable -> _pair.value = PairUi.Failed(dev.qarasky.koremind.R.string.pair_unreachable)
            }
        }
    }

    fun pairFailed(@androidx.annotation.StringRes message: Int) { _pair.value = PairUi.Failed(message) }
    fun pairHandled() { _pair.value = PairUi.Idle }

    // ---- models ------------------------------------------------------------
    fun refreshAll() { refreshChats(); refreshModels() }

    fun refreshModels() = viewModelScope.launch {
        val a = api ?: return@launch
        try {
            val ps = a.models(); val favs = a.favorites().toSet()
            _providers.value = ps; _favorites.value = favs
            val cur = _choice.value
            // A provider that was turned off, lost its key, or a model that is now paid-only means falling back to the default.
            if (cur == null || !isChoiceAllowed(ps, cur.providerId, cur.modelId)) setChoice(defaultChoice(ps)?.let { (p, m) -> Choice(p, m) })
        } catch (_: Exception) { }
    }

    private fun setChoice(c: Choice?) {
        _choice.value = c
        prefs.providerId = c?.providerId; prefs.modelId = c?.modelId; prefs.thinking = c?.thinking
    }

    fun selectModel(providerId: String, modelId: String) {
        val levels = _providers.value.firstOrNull { it.id == providerId }?.models?.firstOrNull { it.id == modelId }?.thinkingLevels ?: emptyList()
        val keep = _choice.value?.thinking?.takeIf { it in levels }
        setChoice(Choice(providerId, modelId, keep))
    }

    fun setThinking(level: String?) { _choice.value?.let { setChoice(it.copy(thinking = level)) } }

    fun toggleFavorite(key: String) = viewModelScope.launch {
        val next = if (key in _favorites.value) _favorites.value - key else _favorites.value + key
        _favorites.value = next
        try { _favorites.value = api?.setFavorites(next.toList())?.toSet() ?: next } catch (_: Exception) { }
    }

    // ---- chats -------------------------------------------------------------
    fun refreshChats() = viewModelScope.launch {
        try { api?.chats()?.let { _chats.value = it; cache.saveChats(it) } } catch (_: Exception) { }
    }

    fun newChat() { streamJob?.cancel(); _busy.value = false; _chatId.value = null; _chat.value = ChatUiState(); _pending.value = emptyList() }

    fun openChat(id: String) {
        if (id == _chatId.value) return
        streamJob?.cancel(); _busy.value = false
        _chatId.value = id
        _chat.value = ChatUiState(messages = cache.messages(id))
        viewModelScope.launch {
            try {
                val d = api?.chat(id) ?: return@launch
                if (_chatId.value != id) return@launch
                _chat.value = ChatUiState(messages = d.messages); cache.saveMessages(id, d.messages)
                // An answer is still being written (the app was closed mid-reply): pick it up.
                if (d.running) {
                    _busy.value = true
                    _chat.update { reconnecting(it) }
                    streamJob = viewModelScope.launch { resume(id) }
                }
            } catch (_: Exception) { }
        }
    }

    /** Reads a turn into the screen. False when the connection broke before the answer ended. */
    private suspend fun read(id: String, events: Flow<StreamEvent>, replay: Boolean = false): Boolean {
        var dropped = false
        var first = true
        events.collect { ev ->
            if (_chatId.value != id) return@collect
            if (ev is StreamEvent.Error && ev.code == "network") { dropped = true; _chat.update { reconnecting(it) }; return@collect }
            // A re-attached stream replays the answer from its first event.
            if (replay && first) _chat.update { restartDraft(it) }
            first = false
            _chat.update { reduce(it, ev) }
            // The composer is free the moment the reply ends; the stream stays open a little longer for the title.
            if (endsTurn(ev)) { _busy.value = false; cache.saveMessages(id, _chat.value.messages) }
            if (ev is StreamEvent.Title) refreshChats()
        }
        return !dropped
    }

    /**
     * The answer keeps running on the server when the connection drops (switching apps, a network change). Re-attach to
     * it, waiting a little longer each time, until it ends or another chat is opened; then show what the server saved.
     */
    private suspend fun resume(id: String) {
        var attempt = 0
        while (_chatId.value == id) {
            if (attempt > 0) delay(minOf(1000L shl (attempt - 1).coerceAtMost(4), 10_000L))
            attempt++
            if (_chatId.value != id) return
            val a = api ?: break
            if (read(id, a.follow(id), replay = true)) break
        }
        if (_chatId.value == id) reload(id)
        _busy.value = false
    }

    /** The chat as the server has it: real ids and versions after a turn, or an answer that finished while we were away. */
    private suspend fun reload(id: String) {
        try {
            val d = api?.chat(id) ?: return
            if (_chatId.value == id) { _chat.update { withServerMessages(it, d.messages) }; cache.saveMessages(id, d.messages) }
        } catch (_: Exception) { }
    }

    /** Replaces a message of yours with [text]: a new version with a new answer; the old one stays reachable. */
    fun edit(messageId: String, text: String) = send(text, editOf = messageId)

    /** Shows another version of an edited message and the conversation that follows it. */
    fun showVariant(messageId: String) {
        val id = _chatId.value ?: return
        if (_busy.value) return
        viewModelScope.launch {
            try {
                val d = api?.branch(id, messageId) ?: return@launch
                if (_chatId.value == id) { _chat.update { withServerMessages(it, d.messages).copy(error = null) }; cache.saveMessages(id, d.messages) }
            } catch (_: Exception) { }
        }
    }

    fun deleteChat(id: String) = viewModelScope.launch {
        try { api?.deleteChat(id) } catch (_: Exception) { }
        cache.forget(id)
        if (_chatId.value == id) newChat()
        refreshChats()
    }

    fun send(text: String, editOf: String? = null) {
        val a = api ?: return
        val c = _choice.value ?: return
        if (editOf == null && uploadingCount(_pending.value) > 0) return // a file is still uploading
        val atts = if (editOf != null) emptyList() else readyAttachments(_pending.value)
        if (text.isBlank() && atts.isEmpty()) return
        _chat.update { if (editOf != null) beginEdit(it, editOf, text) else beginTurn(it, text, atts) }
        if (editOf == null) _pending.value = emptyList()
        _busy.value = true
        streamJob?.cancel() // a previous turn may still be waiting on its title; the server finishes naming either way
        streamJob = viewModelScope.launch {
            val me = coroutineContext[Job]
            try {
                var id = _chatId.value
                if (id == null) { id = a.createChat().id; _chatId.value = id }
                val ended = read(id, a.send(id, SendMessageRequest(text, atts.map { it.id }, ModelRef(c.providerId, c.modelId), c.thinking, editOf)))
                if (ended) reload(id) else resume(id)
            } catch (e: ApiException) {
                _chat.update { reduce(it, StreamEvent.Error("engine", e.message ?: "Request failed")) }
            } finally {
                if (streamJob === me) _busy.value = false
                refreshChats()
            }
        }
    }

    fun stop() {
        val id = _chatId.value
        streamJob?.cancel()
        _busy.value = false
        _chat.update { reduce(it, StreamEvent.Error("aborted", "Stopped")) }
        if (id != null) viewModelScope.launch { try { api?.abort(id) } catch (_: Exception) { } }
    }

    // ---- attachments -------------------------------------------------------
    /** The file shows in the composer at once and uploads in the background; the strip follows its state. */
    fun attach(resolver: ContentResolver, uri: Uri) {
        val a = api ?: return
        _uploadError.value = null
        try {
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            val name = resolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (c.moveToFirst() && i >= 0) c.getString(i) else null
            } ?: "file"
            val size = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
            uploadSizeError(size)?.let { _uploadError.value = it; return }
            val id = java.util.UUID.randomUUID().toString()
            _pending.update { addUploading(it, PendingFile(id, name, mime, uri.toString(), UploadState.Uploading)) }
            upload(a, resolver, id, uri, name, mime)
        } catch (e: Exception) { _uploadError.value = e.message ?: "Upload failed" }
    }

    private fun upload(a: KoreMindApi, resolver: ContentResolver, id: String, uri: Uri, name: String, mime: String) = viewModelScope.launch {
        try {
            val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } } ?: error("Couldn't read that file")
            val att = a.upload(name, mime, bytes)
            _pending.update { markReady(it, id, att) } // ignored when the file was removed meanwhile
        } catch (e: kotlinx.coroutines.CancellationException) { throw e
        } catch (e: Exception) { _pending.update { markFailed(it, id, e.message ?: "Upload failed") } }
    }

    fun showUploadError(message: String) { _uploadError.value = message }

    fun retry(resolver: ContentResolver, id: String) {
        val a = api ?: return
        val f = _pending.value.firstOrNull { it.localId == id } ?: return
        _pending.update { retrying(it, id) }
        upload(a, resolver, id, Uri.parse(f.uri), f.name, f.mime)
    }

    /** Saves Settings from a screen that is going away, so a late edit is never lost. */
    fun saveSettingsNow(s: dev.qarasky.koremind.data.Settings) { viewModelScope.launch { try { api?.putSettings(s); refreshModels() } catch (_: Exception) { } } }

    /** Allow or Deny on the approval card. The card goes away at once; the server resolves the pending tool call. */
    fun answerApproval(approvalId: String, allow: Boolean) {
        val id = _chatId.value ?: return
        _chat.update { dismissApproval(it, approvalId) }
        viewModelScope.launch { try { api?.answerApproval(id, approvalId, allow) } catch (_: Exception) { } }
    }

    fun removePending(id: String) { _pending.update { removePendingFile(it, id) } }
}

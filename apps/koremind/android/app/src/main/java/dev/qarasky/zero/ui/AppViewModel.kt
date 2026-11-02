package dev.qarasky.zero.ui

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.qarasky.zero.data.ApiException
import dev.qarasky.zero.data.PairResult
import dev.qarasky.zero.data.pair
import dev.qarasky.zero.data.parsePairLink
import dev.qarasky.zero.data.Attachment
import dev.qarasky.zero.data.Cache
import dev.qarasky.zero.data.ChatSummary
import dev.qarasky.zero.data.ModelRef
import dev.qarasky.zero.data.Prefs
import dev.qarasky.zero.data.ProviderInfo
import dev.qarasky.zero.data.SendMessageRequest
import dev.qarasky.zero.data.StreamEvent
import dev.qarasky.zero.data.ZeroApi
import dev.qarasky.zero.data.normalizeBackendUrl
import dev.qarasky.zero.data.uploadSizeError
import dev.qarasky.zero.ui.chat.ChatUiState
import dev.qarasky.zero.ui.chat.beginTurn
import dev.qarasky.zero.ui.chat.dismissApproval
import dev.qarasky.zero.ui.model.defaultChoice
import dev.qarasky.zero.ui.model.isChoiceAllowed
import dev.qarasky.zero.ui.chat.endsTurn
import dev.qarasky.zero.ui.chat.reduce
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class Session(val baseUrl: String?, val signedIn: Boolean, val email: String?)
data class Choice(val providerId: String, val modelId: String, val thinking: String? = null)
data class Pending(val attachment: Attachment, val uri: Uri?)

/** Where a QR / deep-link pairing stands. Done is consumed by the app shell, which opens the chat. */
sealed interface PairUi {
    data object Idle : PairUi
    data object Working : PairUi
    data object Done : PairUi
    data class Failed(@androidx.annotation.StringRes val message: Int) : PairUi
}

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val prefs = Prefs(app)
    private val cache = Cache(app)

    private val _session = MutableStateFlow(Session(prefs.baseUrl, prefs.token != null, prefs.email))
    val session: StateFlow<Session> = _session.asStateFlow()

    var api: ZeroApi? = prefs.baseUrl?.let { ZeroApi(it) { prefs.token } }
        private set

    private val _chats = MutableStateFlow(cache.chats())
    val chats: StateFlow<List<ChatSummary>> = _chats.asStateFlow()
    private val _chat = MutableStateFlow(ChatUiState())
    val chat: StateFlow<ChatUiState> = _chat.asStateFlow()
    private val _chatId = MutableStateFlow<String?>(null)
    val chatId: StateFlow<String?> = _chatId.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _pending = MutableStateFlow<List<Pending>>(emptyList())
    val pending: StateFlow<List<Pending>> = _pending.asStateFlow()
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

    init { if (_session.value.signedIn) refreshAll() }

    // ---- session -----------------------------------------------------------
    /** Checks the server answers, then remembers it. Returns the server's setupRequired flag. */
    suspend fun connect(input: String): Result<Boolean> {
        val url = normalizeBackendUrl(input) ?: return Result.failure(IllegalArgumentException("That doesn't look like an address. Try something like 192.168.1.20:8787."))
        return try {
            val h = ZeroApi(url) { null }.health()
            prefs.baseUrl = url; prefs.signOut()
            api = ZeroApi(url) { prefs.token }
            _session.value = Session(url, false, null)
            Result.success(h.setupRequired)
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun setupRequired(): Boolean = try { api?.health()?.setupRequired ?: false } catch (_: Exception) { false }

    suspend fun authenticate(email: String, password: String, create: Boolean): Result<Unit> = try {
        val a = api ?: error("Not connected")
        val r = if (create) a.register(email, password) else a.login(email, password)
        prefs.token = r.token; prefs.email = r.user.email
        _session.value = Session(prefs.baseUrl, true, r.user.email)
        refreshAll()
        Result.success(Unit)
    } catch (e: Exception) { Result.failure(e) }

    fun signOut() {
        viewModelScope.launch { try { api?.logout() } catch (_: Exception) { } }
        prefs.signOut(); cache.clear()
        streamJob?.cancel()
        _chat.value = ChatUiState(); _chatId.value = null; _chats.value = emptyList(); _busy.value = false
        _session.value = Session(prefs.baseUrl, false, null)
    }

    // ---- pairing (scan a QR code shown on the web, or open a zero://pair link) --------------------
    /** Signs in with a scanned or opened pairing link: the first reachable address redeems the code. */
    fun startPair(text: String) {
        if (_pair.value is PairUi.Working) return
        val link = parsePairLink(text)
        if (link == null) { _pair.value = PairUi.Failed(dev.qarasky.zero.R.string.pair_invalid); return }
        _pair.value = PairUi.Working
        viewModelScope.launch {
            val r = pair(
                link,
                probe = { url -> try { ZeroApi(url) { null }.healthQuick(); true } catch (_: Exception) { false } },
                redeem = { url, code -> ZeroApi(url) { null }.redeemPair(code) },
            )
            when (r) {
                is PairResult.Ok -> {
                    prefs.baseUrl = r.url; prefs.token = r.auth.token; prefs.email = r.auth.user.email
                    api = ZeroApi(r.url) { prefs.token }
                    cache.clear()
                    streamJob?.cancel()
                    _chat.value = ChatUiState(); _chatId.value = null; _chats.value = emptyList(); _busy.value = false
                    _session.value = Session(r.url, true, r.auth.user.email)
                    refreshAll()
                    _pair.value = PairUi.Done
                }
                PairResult.Invalid -> _pair.value = PairUi.Failed(dev.qarasky.zero.R.string.pair_invalid)
                PairResult.Unreachable -> _pair.value = PairUi.Failed(dev.qarasky.zero.R.string.pair_unreachable)
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
                if (_chatId.value == id) { _chat.value = ChatUiState(messages = d.messages); cache.saveMessages(id, d.messages) }
            } catch (_: Exception) { }
        }
    }

    fun deleteChat(id: String) = viewModelScope.launch {
        try { api?.deleteChat(id) } catch (_: Exception) { }
        cache.forget(id)
        if (_chatId.value == id) newChat()
        refreshChats()
    }

    fun send(text: String) {
        val a = api ?: return
        val c = _choice.value ?: return
        val atts = _pending.value.map { it.attachment }
        if (text.isBlank() && atts.isEmpty()) return
        _chat.update { beginTurn(it, text, atts) }
        _pending.value = emptyList()
        _busy.value = true
        streamJob?.cancel() // a previous turn may still be waiting on its title; the server finishes naming either way
        streamJob = viewModelScope.launch {
            val me = coroutineContext[Job]
            try {
                var id = _chatId.value
                if (id == null) { id = a.createChat().id; _chatId.value = id }
                a.send(id, SendMessageRequest(text, atts.map { it.id }, ModelRef(c.providerId, c.modelId), c.thinking)).collect { ev ->
                    _chat.update { reduce(it, ev) }
                    // The composer is free the moment the reply ends; the stream stays open a little longer for the title.
                    if (endsTurn(ev)) { _busy.value = false; cache.saveMessages(id, _chat.value.messages) }
                    if (ev is StreamEvent.Title) refreshChats()
                }
                cache.saveMessages(id, _chat.value.messages)
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
    fun attach(resolver: ContentResolver, uri: Uri) = viewModelScope.launch {
        val a = api ?: return@launch
        _uploadError.value = null
        try {
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            val name = resolver.query(uri, null, null, null, null)?.use { c ->
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (c.moveToFirst() && i >= 0) c.getString(i) else null
            } ?: "file"
            val size = resolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else null }
            uploadSizeError(size)?.let { _uploadError.value = it; return@launch }
            val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } } ?: error("Couldn't read that file")
            val att = a.upload(name, mime, bytes)
            _pending.update { it + Pending(att, uri) }
        } catch (e: Exception) { _uploadError.value = e.message ?: "Upload failed" }
    }

    /** Saves Settings from a screen that is going away, so a late edit is never lost. */
    fun saveSettingsNow(s: dev.qarasky.zero.data.Settings) { viewModelScope.launch { try { api?.putSettings(s); refreshModels() } catch (_: Exception) { } } }

    /** Allow or Deny on the approval card. The card goes away at once; the server resolves the pending tool call. */
    fun answerApproval(approvalId: String, allow: Boolean) {
        val id = _chatId.value ?: return
        _chat.update { dismissApproval(it, approvalId) }
        viewModelScope.launch { try { api?.answerApproval(id, approvalId, allow) } catch (_: Exception) { } }
    }

    fun removePending(id: String) { _pending.update { l -> l.filterNot { it.attachment.id == id } } }
}

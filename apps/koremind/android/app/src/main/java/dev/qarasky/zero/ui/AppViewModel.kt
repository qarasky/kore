package dev.qarasky.zero.ui

import android.app.Application
import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.qarasky.zero.data.ApiException
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
import dev.qarasky.zero.ui.chat.ChatUiState
import dev.qarasky.zero.ui.chat.beginTurn
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

    // ---- models ------------------------------------------------------------
    fun refreshAll() { refreshChats(); refreshModels() }

    fun refreshModels() = viewModelScope.launch {
        val a = api ?: return@launch
        try {
            val ps = a.models(); val favs = a.favorites().toSet()
            _providers.value = ps; _favorites.value = favs
            val cur = _choice.value
            val valid = cur != null && ps.any { p -> p.id == cur.providerId && p.models.any { it.id == cur.modelId } }
            if (!valid) {
                val p = ps.firstOrNull { it.models.isNotEmpty() }
                val m = p?.models?.firstOrNull { it.isDefault } ?: p?.models?.firstOrNull()
                setChoice(if (p != null && m != null) Choice(p.id, m.id) else null)
            }
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
        streamJob = viewModelScope.launch {
            try {
                var id = _chatId.value
                if (id == null) { id = a.createChat().id; _chatId.value = id }
                a.send(id, SendMessageRequest(text, atts.map { it.id }, ModelRef(c.providerId, c.modelId), c.thinking)).collect { ev ->
                    _chat.update { reduce(it, ev) }
                }
                cache.saveMessages(id, _chat.value.messages)
            } catch (e: ApiException) {
                _chat.update { reduce(it, StreamEvent.Error("engine", e.message ?: "Request failed")) }
            } finally {
                _busy.value = false
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
            val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { resolver.openInputStream(uri)?.use { it.readBytes() } } ?: error("Couldn't read that file")
            val att = a.upload(name, mime, bytes)
            _pending.update { it + Pending(att, uri) }
        } catch (e: Exception) { _uploadError.value = e.message ?: "Upload failed" }
    }

    fun removePending(id: String) { _pending.update { l -> l.filterNot { it.attachment.id == id } } }
}

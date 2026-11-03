package dev.qarasky.koremind.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

val KoreMindJson = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

@Serializable data class User(val id: String, val email: String, val isOwner: Boolean)
@Serializable data class AuthRequest(val email: String, val password: String)
@Serializable data class AuthResponse(val token: String, val user: User)
@Serializable data class Health(val name: String, val version: String, val setupRequired: Boolean)
@Serializable data class ModelInfo(val id: String, val name: String, val vision: Boolean, val thinkingLevels: List<String>, val isDefault: Boolean, val free: Boolean = false)
/** status: "ready", "needs_connection" (no key / not signed in) or "disabled" (turned off in Settings). Models are empty unless ready. */
@Serializable data class ProviderInfo(val id: String, val name: String, val connected: Boolean, val models: List<ModelInfo>, val status: String = "ready")
@Serializable data class ProviderConnection(val id: String, val name: String, val connected: Boolean, val methods: List<String>, val supportsFreeFilter: Boolean = false)
@Serializable data class ChatSummary(val id: String, val title: String, val updatedAt: Long)
@Serializable data class Attachment(val id: String, val name: String, val mime: String, val size: Long)
@Serializable data class Source(val title: String, val url: String)
/** What the assistant did with notes during a turn. [chat] is set when another chat's notes were involved. */
@Serializable data class Activity(val kind: String, val title: String, val chat: String? = null)
@Serializable data class ChatMessage(
    val id: String,
    val role: String,
    val text: String,
    val attachments: List<Attachment> = emptyList(),
    val sources: List<Source> = emptyList(),
    val activity: List<Activity> = emptyList(),
    val createdAt: Long = 0,
)
@Serializable data class ModelRef(val providerId: String, val modelId: String)
@Serializable data class SendMessageRequest(val text: String, val attachmentIds: List<String>, val model: ModelRef, val thinking: String? = null)
@Serializable data class MemoryEntry(val id: String, val text: String, val updatedAt: Long)
@Serializable data class Settings(
    val memoryEnabled: Boolean = true, val displayName: String = "", val tone: String = "", val about: String = "",
    val disabledProviders: List<String> = emptyList(), val freeOnlyProviders: List<String> = emptyList(),
)
@Serializable data class ChatDetail(val chat: ChatSummary, val messages: List<ChatMessage>)
@Serializable data class KeyBody(val key: String)
@Serializable data class TitleBody(val title: String)
@Serializable data class TextBody(val text: String)
@Serializable data class PairCodeBody(val code: String)
@Serializable data class ApprovalAnswer(val allow: Boolean)

sealed interface StreamEvent {
    data class Status(val state: String) : StreamEvent
    data class Delta(val text: String) : StreamEvent
    data class Source(val title: String, val url: String) : StreamEvent
    data class Done(val messageId: String) : StreamEvent
    /** The assistant used (or was refused) the notes tools. Also stored on the finished message. */
    data class Noted(val activity: Activity) : StreamEvent
    /** The assistant wants another chat's notes; the stream stays open until the user answers or it expires. */
    data class Approval(val id: String, val action: String, val chat: String) : StreamEvent
    data class ApprovalClosed(val id: String, val outcome: String) : StreamEvent
    /** Arrives after Done on a new chat, once the chosen model has named it. Best effort. */
    data class Title(val title: String) : StreamEvent
    data class Error(val code: String, val message: String) : StreamEvent
}

fun parseStreamEvent(json: String): StreamEvent? = try {
    val o: JsonObject = KoreMindJson.parseToJsonElement(json).jsonObject
    fun s(k: String) = o[k]?.jsonPrimitive?.content ?: ""
    when (s("type")) {
        "status" -> StreamEvent.Status(s("state"))
        "delta" -> StreamEvent.Delta(s("text"))
        "source" -> StreamEvent.Source(s("title"), s("url"))
        "done" -> StreamEvent.Done(s("messageId"))
        "title" -> StreamEvent.Title(s("title"))
        "activity" -> StreamEvent.Noted(Activity(s("kind"), s("title"), o["chat"]?.jsonPrimitive?.content))
        "approval" -> StreamEvent.Approval(s("id"), s("action"), s("chat"))
        "approval_closed" -> StreamEvent.ApprovalClosed(s("id"), s("outcome"))
        "error" -> StreamEvent.Error(s("code"), s("message"))
        else -> null
    }
} catch (_: Exception) { null }

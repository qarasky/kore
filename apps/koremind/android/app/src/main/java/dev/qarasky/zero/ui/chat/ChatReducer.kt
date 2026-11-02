package dev.qarasky.zero.ui.chat

import dev.qarasky.zero.data.Activity
import dev.qarasky.zero.data.Attachment
import dev.qarasky.zero.data.ChatMessage
import dev.qarasky.zero.data.Source
import dev.qarasky.zero.data.StreamEvent
import java.util.UUID

/** The assistant asked to use another chat's notes and is waiting for the user. [action] is "read" or "edit". */
data class PendingApproval(val id: String, val action: String, val chat: String)
data class Draft(
    val text: String = "", val sources: List<Source> = emptyList(), val status: String? = null,
    val activity: List<Activity> = emptyList(), val approvals: List<PendingApproval> = emptyList(),
    /** A request timed out unanswered: a muted note is shown until the reply ends. */
    val expired: Boolean = false,
)
data class UiError(val code: String, val message: String)
data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val draft: Draft? = null,
    val error: UiError? = null,
    val connectProvider: Boolean = false,
)

private fun localId() = "local-${UUID.randomUUID()}"

/** Called the instant the user sends: shows their message and a thinking indicator before any network response. */
fun beginTurn(s: ChatUiState, text: String, attachments: List<Attachment>): ChatUiState = ChatUiState(
    messages = s.messages + ChatMessage(localId(), "user", text, attachments, emptyList(), emptyList(), System.currentTimeMillis()),
    draft = Draft(status = "thinking"),
)

fun reduce(s: ChatUiState, ev: StreamEvent): ChatUiState {
    val d = s.draft ?: Draft()
    return when (ev) {
        is StreamEvent.Status -> s.copy(draft = d.copy(status = ev.state))
        is StreamEvent.Delta -> s.copy(draft = d.copy(text = d.text + ev.text, status = null))
        is StreamEvent.Source -> s.copy(draft = d.copy(sources = d.sources + Source(ev.title, ev.url)))
        is StreamEvent.Title -> s
        is StreamEvent.Noted -> s.copy(draft = d.copy(activity = d.activity + ev.activity))
        is StreamEvent.Approval ->
            if (d.approvals.any { it.id == ev.id }) s
            else s.copy(draft = d.copy(approvals = d.approvals + PendingApproval(ev.id, ev.action, ev.chat)))
        is StreamEvent.ApprovalClosed ->
            if (d.approvals.none { it.id == ev.id }) s
            else s.copy(draft = d.copy(approvals = d.approvals.filterNot { it.id == ev.id }, expired = d.expired || ev.outcome == "expired"))
        is StreamEvent.Done -> s.copy(
            draft = null,
            messages = s.messages + ChatMessage(ev.messageId, "assistant", d.text, emptyList(), d.sources, d.activity, System.currentTimeMillis()),
        )
        is StreamEvent.Error -> {
            val keep = d.text.isNotEmpty() || d.sources.isNotEmpty() || d.activity.isNotEmpty()
            ChatUiState(
                messages = if (keep) s.messages + ChatMessage(localId(), "assistant", d.text, emptyList(), d.sources, d.activity, System.currentTimeMillis()) else s.messages,
                draft = null,
                error = if (ev.code == "aborted") null else UiError(ev.code, ev.message),
                connectProvider = ev.code == "no_provider",
            )
        }
    }
}

/** The user tapped Allow or Deny: the card goes away at once, without waiting for the server's `approval_closed`. */
fun dismissApproval(s: ChatUiState, id: String): ChatUiState {
    val d = s.draft ?: return s
    return s.copy(draft = d.copy(approvals = d.approvals.filterNot { it.id == id }))
}

fun canSend(text: String, pendingCount: Int, busy: Boolean, hasModel: Boolean): Boolean =
    hasModel && !busy && (text.isNotBlank() || pendingCount > 0)

/** The reply is over (or failed). The stream may stay open a moment longer for the chat title. */
fun endsTurn(ev: StreamEvent): Boolean = ev is StreamEvent.Done || ev is StreamEvent.Error

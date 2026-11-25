package dev.qarasky.koremind.ui.chat

import dev.qarasky.koremind.data.Activity
import dev.qarasky.koremind.data.Attachment
import dev.qarasky.koremind.data.ChatMessage
import dev.qarasky.koremind.data.Source
import dev.qarasky.koremind.data.addSource
import dev.qarasky.koremind.data.StreamEvent
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

/**
 * Editing a user message: everything from it on leaves the screen, the new text takes its place (with the original's
 * files) and a new answer starts. The server keeps the old version as a variant. Mirrors web beginEdit.
 */
fun beginEdit(s: ChatUiState, messageId: String, text: String): ChatUiState {
    val i = s.messages.indexOfFirst { it.id == messageId && it.role == "user" }
    if (i < 0) return s
    return beginTurn(s.copy(messages = s.messages.take(i)), text, s.messages[i].attachments)
}

/** The connection broke mid-answer: keep what arrived and say we are reconnecting. The answer goes on on the server. */
fun reconnecting(s: ChatUiState): ChatUiState = s.copy(draft = (s.draft ?: Draft()).copy(status = "reconnecting"))

/** Re-attached to the running answer, which replays from its first event: start the draft over. */
fun restartDraft(s: ChatUiState): ChatUiState = s.copy(draft = Draft(status = "thinking"))

/** The chat as the server has it (real ids, versions), keeping an error shown for the last turn. */
fun withServerMessages(s: ChatUiState, messages: List<ChatMessage>): ChatUiState = s.copy(messages = messages, draft = null)

/** (2, 3) for the second of three versions of an edited message, or null when it has one version. */
fun variantPosition(m: ChatMessage): Pair<Int, Int>? {
    val i = m.siblings.indexOf(m.id)
    return if (m.siblings.size > 1 && i >= 0) (i + 1) to m.siblings.size else null
}

/** The version [step] away (-1 previous, +1 next), or null at either end. */
fun variantAt(m: ChatMessage, step: Int): String? {
    val i = m.siblings.indexOf(m.id)
    return if (i >= 0) m.siblings.getOrNull(i + step) else null
}

fun reduce(s: ChatUiState, ev: StreamEvent): ChatUiState {
    val d = s.draft ?: Draft()
    return when (ev) {
        is StreamEvent.Status -> s.copy(draft = d.copy(status = ev.state))
        is StreamEvent.Delta -> s.copy(draft = d.copy(text = d.text + ev.text, status = null))
        is StreamEvent.Source -> s.copy(draft = d.copy(sources = addSource(d.sources, Source(ev.title, ev.url))))
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
        is StreamEvent.Error -> if (ev.code == "network") reconnecting(s) else {
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

/** [fileCount] counts files that finished uploading; a send waits while any is still [uploading], and a failed one is left out. */
fun canSend(text: String, fileCount: Int, uploading: Int, busy: Boolean, hasModel: Boolean): Boolean =
    hasModel && !busy && uploading == 0 && (text.isNotBlank() || fileCount > 0)

/** The reply is over (or failed). The stream may stay open a moment longer for the chat title. */
fun endsTurn(ev: StreamEvent): Boolean = ev is StreamEvent.Done || (ev is StreamEvent.Error && ev.code != "network")

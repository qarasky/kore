package dev.qarasky.koremind.ui.chat

import dev.qarasky.koremind.data.Attachment

enum class UploadState { Uploading, Ready, Failed }

/**
 * A file picked for the next message: shown at once, uploaded in the background. [uri] is the content URI as text, so these
 * helpers stay plain Kotlin. Same names and rules as web/lib/pending-files.ts.
 */
data class PendingFile(
    val localId: String, val name: String, val mime: String, val uri: String,
    val state: UploadState, val attachment: Attachment? = null, val error: String? = null,
)

private fun List<PendingFile>.update(id: String, patch: (PendingFile) -> PendingFile): List<PendingFile> =
    if (none { it.localId == id }) this else map { if (it.localId == id) patch(it) else it }

fun addUploading(list: List<PendingFile>, f: PendingFile): List<PendingFile> = list + f.copy(state = UploadState.Uploading)
fun markReady(list: List<PendingFile>, id: String, attachment: Attachment): List<PendingFile> = list.update(id) { it.copy(state = UploadState.Ready, attachment = attachment, error = null) }
fun markFailed(list: List<PendingFile>, id: String, error: String): List<PendingFile> = list.update(id) { it.copy(state = UploadState.Failed, error = error) }
fun retrying(list: List<PendingFile>, id: String): List<PendingFile> = list.update(id) { it.copy(state = UploadState.Uploading, error = null) }
fun removePending(list: List<PendingFile>, id: String): List<PendingFile> = if (list.none { it.localId == id }) list else list.filterNot { it.localId == id }

/** What gets sent: only the files that finished uploading, in pick order. */
fun readyAttachments(list: List<PendingFile>): List<Attachment> = list.mapNotNull { if (it.state == UploadState.Ready) it.attachment else null }
fun uploadingCount(list: List<PendingFile>): Int = list.count { it.state == UploadState.Uploading }

/** The reason to show for failed uploads: the latest failure's message, or [fallback] when it has none. Null when nothing failed. */
fun uploadNotice(list: List<PendingFile>, fallback: String): String? =
    list.lastOrNull { it.state == UploadState.Failed }?.let { it.error?.takeIf { e -> e.isNotEmpty() } ?: fallback }

/** Photos in cache/camera/ that no pending file points at any more; the caller deletes them. */
fun cameraFilesToDelete(existing: List<String>, pending: List<PendingFile>): List<String> =
    existing.filterNot { name -> pending.any { it.uri.endsWith("/$name") } }

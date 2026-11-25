package dev.qarasky.koremind.ui.chat

import androidx.annotation.StringRes
import dev.qarasky.koremind.R
import dev.qarasky.koremind.data.Activity

/** A string resource plus its arguments, so wording lives in strings.xml and stays testable. */
data class Label(@StringRes val res: Int, val args: List<String> = emptyList())

/** Chip text for what the assistant did with notes or memory. */
fun activityLabel(a: Activity): Label = when (a.kind) {
    "saved" -> Label(R.string.activity_saved, listOf(a.title))
    "edited" -> Label(R.string.activity_edited, listOf(a.title))
    "read" -> if (a.chat != null) Label(R.string.activity_read_other, listOf(a.chat)) else Label(R.string.activity_read)
    "memory_saved" -> Label(R.string.activity_memory_saved, listOf(a.title))
    "memory_updated" -> Label(R.string.activity_memory_updated, listOf(a.title))
    "memory_read" -> if (a.title.isNotEmpty()) Label(R.string.activity_memory_read_for, listOf(a.title)) else Label(R.string.activity_memory_read)
    "memory_deleted" -> Label(R.string.activity_memory_deleted, listOf(a.title))
    else -> Label(R.string.activity_denied, listOf(a.chat ?: a.title))
}

/** The approval card's question. */
fun approvalLabel(p: PendingApproval): Label =
    Label(if (p.action == "edit") R.string.approval_edit else R.string.approval_read, listOf(p.chat))

package dev.qarasky.koremind

import dev.qarasky.koremind.data.Attachment
import dev.qarasky.koremind.ui.chat.PendingFile
import dev.qarasky.koremind.ui.chat.UploadState
import dev.qarasky.koremind.ui.chat.addUploading
import dev.qarasky.koremind.ui.chat.cameraFilesToDelete
import dev.qarasky.koremind.ui.chat.markFailed
import dev.qarasky.koremind.ui.chat.markReady
import dev.qarasky.koremind.ui.chat.readyAttachments
import dev.qarasky.koremind.ui.chat.removePending
import dev.qarasky.koremind.ui.chat.retrying
import dev.qarasky.koremind.ui.chat.uploadNotice
import dev.qarasky.koremind.ui.chat.uploadingCount
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendingFilesTest {
    private fun file(id: String) = PendingFile(id, "$id.png", "image/png", "content://x/$id", UploadState.Uploading)
    private fun att(id: String) = Attachment(id, "$id.png", "image/png", 10)
    private fun three() = listOf("A", "B", "C").fold(emptyList<PendingFile>()) { l, k -> addUploading(l, file(k)) }

    @Test fun `files finishing out of order keep the pick order, each updated in place`() {
        var list = three()
        list = markReady(list, "B", att("b"))
        list = markReady(list, "C", att("c"))
        list = markReady(list, "A", att("a"))
        assertEquals(listOf("A", "B", "C"), list.map { it.localId })
        assertEquals(listOf(UploadState.Ready, UploadState.Ready, UploadState.Ready), list.map { it.state })
        assertEquals(listOf("a", "b", "c"), readyAttachments(list).map { it.id })
    }

    @Test fun `only uploading files count as uploading and only ready ones are sent`() {
        var list = three()
        list = markReady(list, "A", att("a"))
        list = markFailed(list, "B", "offline")
        assertEquals(1, uploadingCount(list))
        assertEquals(listOf("a"), readyAttachments(list).map { it.id })
    }

    @Test fun `a failed file keeps its error and goes back to uploading on retry with the error cleared`() {
        var list = markFailed(three(), "B", "offline")
        assertEquals(UploadState.Failed, list[1].state)
        assertEquals("offline", list[1].error)
        list = retrying(list, "B")
        assertEquals(UploadState.Uploading, list[1].state)
        assertNull(list[1].error)
    }

    @Test fun `an upload that ends after its file was removed changes nothing`() {
        val list = removePending(three(), "B")
        assertEquals(listOf("A", "C"), list.map { it.localId })
        assertEquals(list, markReady(list, "B", att("b")))
        assertEquals(list, markFailed(list, "B", "x"))
        assertEquals(list, retrying(list, "B"))
        assertEquals(list, removePending(list, "B"))
    }

    @Test fun `uploadNotice names the latest failure, falls back to the generic text, and is null when nothing failed`() {
        assertNull(uploadNotice(three(), "Upload failed"))
        var list = markFailed(three(), "A", "That file type isn't supported.")
        list = markFailed(list, "B", "offline")
        assertEquals("offline", uploadNotice(list, "Upload failed"))
        assertEquals("Upload failed", uploadNotice(markFailed(three(), "C", ""), "Upload failed"))
        assertNull(uploadNotice(removePending(markFailed(three(), "C", "x"), "C"), "Upload failed"))
    }

    @Test fun `cameraFilesToDelete keeps only the photos a pending file still points at`() {
        val pending = listOf(PendingFile("1", "a.jpg", "image/jpeg", "content://dev.qarasky.koremind.files/camera/IMG_a.jpg", UploadState.Ready))
        assertEquals(listOf("IMG_b.jpg"), cameraFilesToDelete(listOf("IMG_a.jpg", "IMG_b.jpg"), pending))
        assertEquals(listOf("IMG_a.jpg"), cameraFilesToDelete(listOf("IMG_a.jpg"), emptyList()))
        assertEquals(emptyList<String>(), cameraFilesToDelete(emptyList(), pending))
    }
}

package dev.qarasky.zero

import dev.qarasky.zero.data.Attachment
import dev.qarasky.zero.data.ModelInfo
import dev.qarasky.zero.data.uploadSizeError
import dev.qarasky.zero.ui.chat.canSend
import dev.qarasky.zero.ui.model.lacksVision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SendChecksTest {
    @Test fun `canSend refuses without a model while busy or when empty`() {
        assertTrue(canSend("hi", 0, busy = false, hasModel = true))
        assertFalse(canSend("hi", 0, busy = false, hasModel = false))
        assertFalse(canSend("hi", 0, busy = true, hasModel = true))
        assertFalse(canSend("  ", 0, busy = false, hasModel = true))
        assertTrue(canSend("", 1, busy = false, hasModel = true))
    }

    @Test fun `uploadSizeError refuses big files before reading them and allows unknown sizes`() {
        assertEquals("That file is too large. The limit is 20 MB.", uploadSizeError(300L * 1024 * 1024))
        assertNull(uploadSizeError(1024))
        assertNull(uploadSizeError(null))
    }

    @Test fun `lacksVision warns only for images on a text-only model`() {
        val img = listOf(Attachment("a", "p.png", "image/png", 1))
        val pdf = listOf(Attachment("b", "d.pdf", "application/pdf", 1))
        val textOnly = ModelInfo("m", "M", false, emptyList(), true)
        assertTrue(lacksVision(img, textOnly))
        assertFalse(lacksVision(img, textOnly.copy(vision = true)))
        assertFalse(lacksVision(pdf, textOnly))
        assertFalse(lacksVision(img, null))
    }
}

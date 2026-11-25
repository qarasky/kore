package dev.qarasky.koremind

import dev.qarasky.koremind.data.Attachment
import dev.qarasky.koremind.data.ChatDetail
import dev.qarasky.koremind.data.ChatMessage
import dev.qarasky.koremind.data.KoreMindJson
import dev.qarasky.koremind.data.SendMessageRequest
import dev.qarasky.koremind.data.ModelRef
import dev.qarasky.koremind.data.StreamEvent
import dev.qarasky.koremind.ui.chat.ChatUiState
import dev.qarasky.koremind.ui.chat.beginEdit
import dev.qarasky.koremind.ui.chat.beginTurn
import dev.qarasky.koremind.ui.chat.endsTurn
import dev.qarasky.koremind.ui.chat.reconnecting
import dev.qarasky.koremind.ui.chat.reduce
import dev.qarasky.koremind.ui.chat.restartDraft
import dev.qarasky.koremind.ui.chat.variantAt
import dev.qarasky.koremind.ui.chat.variantPosition
import dev.qarasky.koremind.ui.chat.withServerMessages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class EditAndReconnectTest {
    private fun msg(id: String, role: String, text: String, attachments: List<Attachment> = emptyList(), siblings: List<String> = emptyList()) =
        ChatMessage(id, role, text, attachments, emptyList(), emptyList(), 1, siblings = siblings)

    @Test fun `editing drops the message and everything after it, keeps its files and starts a new answer`() {
        val file = Attachment("f", "a.png", "image/png", 1)
        val s = ChatUiState(messages = listOf(msg("u1", "user", "a"), msg("a1", "assistant", "A"), msg("u2", "user", "b", listOf(file)), msg("a2", "assistant", "B")))
        val e = beginEdit(s, "u2", "b2")
        assertEquals(listOf("a", "A", "b2"), e.messages.map { it.text })
        assertEquals(listOf(file), e.messages[2].attachments)
        assertEquals("thinking", e.draft?.status)
        assertSame(s, beginEdit(s, "a1", "x"))
        assertSame(s, beginEdit(s, "nope", "x"))
    }

    @Test fun `a dropped connection keeps the partial answer and shows reconnecting, a replay starts it over`() {
        var s = beginTurn(ChatUiState(), "q", emptyList())
        s = reduce(s, StreamEvent.Delta("par"))
        s = reduce(s, StreamEvent.Error("network", "The connection dropped."))
        assertEquals("par", s.draft?.text)
        assertEquals("reconnecting", s.draft?.status)
        assertNull(s.error)
        assertEquals(1, s.messages.size)
        assertFalse(endsTurn(StreamEvent.Error("network", "x")))
        assertTrue(endsTurn(StreamEvent.Error("engine", "x")))
        assertEquals("reconnecting", reconnecting(ChatUiState()).draft?.status)
        assertEquals("", restartDraft(s).draft?.text)
        assertEquals("thinking", restartDraft(s).draft?.status)
    }

    @Test fun `the server's messages replace the local ones and end the draft`() {
        val s = withServerMessages(beginTurn(ChatUiState(), "q", emptyList()), listOf(msg("u1", "user", "q"), msg("a1", "assistant", "A")))
        assertEquals(listOf("u1", "a1"), s.messages.map { it.id })
        assertNull(s.draft)
    }

    @Test fun `versions read as 2 of 3 and step to their neighbours`() {
        val m = msg("b", "user", "x", siblings = listOf("a", "b", "c"))
        assertEquals(2 to 3, variantPosition(m))
        assertEquals("a", variantAt(m, -1))
        assertEquals("c", variantAt(m, 1))
        assertNull(variantAt(msg("c", "user", "x", siblings = listOf("a", "b", "c")), 1))
        assertNull(variantPosition(msg("a", "user", "x")))
        assertNull(variantAt(msg("a", "user", "x"), 1))
    }

    @Test fun `chat detail and messages decode versions and the running flag, an edit is sent with editOf`() {
        val d = KoreMindJson.decodeFromString(ChatDetail.serializer(), """{"chat":{"id":"c","title":"t","updatedAt":1},"running":true,"messages":[{"id":"u2","role":"user","text":"x","attachments":[],"sources":[],"activity":[],"createdAt":1,"parentId":"a1","siblings":["u1","u2"]}]}""")
        assertTrue(d.running)
        assertEquals(listOf("u1", "u2"), d.messages[0].siblings)
        assertEquals("a1", d.messages[0].parentId)
        val old = KoreMindJson.decodeFromString(ChatDetail.serializer(), """{"chat":{"id":"c","title":"t","updatedAt":1},"messages":[]}""")
        assertFalse(old.running)
        val body = KoreMindJson.encodeToString(SendMessageRequest.serializer(), SendMessageRequest("x", emptyList(), ModelRef("p", "m"), editOf = "u1"))
        assertTrue(body.contains("\"editOf\":\"u1\""))
    }
}

package dev.qarasky.zero

import dev.qarasky.zero.data.StreamEvent
import dev.qarasky.zero.ui.chat.ChatUiState
import dev.qarasky.zero.ui.chat.beginTurn
import dev.qarasky.zero.ui.chat.endsTurn
import dev.qarasky.zero.ui.chat.reduce
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatReducerTest {
    private fun run(vararg events: StreamEvent, text: String = "hi"): ChatUiState =
        events.fold(beginTurn(ChatUiState(), text, emptyList())) { s, e -> reduce(s, e) }

    @Test fun `beginTurn shows the user message and thinking before any event`() {
        val s = beginTurn(ChatUiState(), "hello", emptyList())
        assertEquals("user", s.messages[0].role)
        assertEquals("hello", s.messages[0].text)
        assertEquals("thinking", s.draft?.status)
    }

    @Test fun `reduce appends deltas in order and clears thinking`() {
        val s = run(StreamEvent.Delta("Hel"), StreamEvent.Delta("lo"))
        assertEquals("Hello", s.draft?.text)
        assertNull(s.draft?.status)
    }

    @Test fun `reduce shows searching then sources`() {
        val s = run(StreamEvent.Status("searching"), StreamEvent.Source("Bun", "https://bun.sh"))
        assertEquals("searching", s.draft?.status)
        assertEquals("https://bun.sh", s.draft?.sources?.single()?.url)
    }

    @Test fun `reduce done finalizes the assistant message`() {
        val s = run(StreamEvent.Delta("Hi!"), StreamEvent.Done("m9"))
        assertNull(s.draft)
        assertEquals(listOf("user", "assistant"), s.messages.map { it.role })
        assertEquals("m9", s.messages[1].id)
        assertEquals("Hi!", s.messages[1].text)
    }

    @Test fun `reduce error no_provider sets connectProvider and keeps partial text`() {
        val s = run(StreamEvent.Delta("part"), StreamEvent.Error("no_provider", "Connect"))
        assertTrue(s.connectProvider)
        assertNotNull(s.error)
        assertEquals("part", s.messages.last().text)
    }

    @Test fun `reduce error with no partial text leaves no empty bubble`() {
        val s = run(StreamEvent.Error("engine", "boom"))
        assertEquals(listOf("user"), s.messages.map { it.role })
        assertNull(s.draft)
    }

    @Test fun `aborted error shows no error message`() {
        val s = run(StreamEvent.Delta("x"), StreamEvent.Error("aborted", "Stopped"))
        assertNull(s.error)
    }

    @Test fun `a title after done changes nothing in the conversation`() {
        val done = run(StreamEvent.Delta("Hi!"), StreamEvent.Done("m9"))
        assertEquals(done, reduce(done, StreamEvent.Title("Greeting")))
    }

    @Test fun `done and error end the turn so the composer is usable before the title arrives`() {
        assertTrue(endsTurn(StreamEvent.Done("m")))
        assertTrue(endsTurn(StreamEvent.Error("engine", "boom")))
        assertTrue(!endsTurn(StreamEvent.Title("t")))
        assertTrue(!endsTurn(StreamEvent.Delta("x")))
    }
}

package dev.qarasky.koremind

import dev.qarasky.koremind.data.SseParser
import dev.qarasky.koremind.data.StreamEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class SseParserTest {
    @Test fun `SseParser handles an event split across two chunks`() {
        val p = SseParser()
        assertEquals(emptyList<StreamEvent>(), p.feed("data: {\"type\":\"del".toByteArray()))
        val out = p.feed("ta\",\"text\":\"hi\"}\n\ndata: {\"type\":\"done\",\"messageId\":\"m\"}\n\n".toByteArray())
        assertEquals(listOf(StreamEvent.Delta("hi"), StreamEvent.Done("m")), out)
    }

    @Test fun `SseParser parses error and status events`() {
        val out = SseParser().feed(
            ("data: {\"type\":\"status\",\"state\":\"searching\"}\n\n" +
                "data: {\"type\":\"error\",\"code\":\"no_provider\",\"message\":\"Connect\"}\n\n").toByteArray(),
        )
        assertEquals(listOf(StreamEvent.Status("searching"), StreamEvent.Error("no_provider", "Connect")), out)
    }

    @Test fun `SseParser keeps multibyte characters split across chunks`() {
        val bytes = "data: {\"type\":\"delta\",\"text\":\"héllo\"}\n\n".toByteArray()
        val cut = bytes.indexOf(0xC3.toByte()) + 1
        val p = SseParser()
        assertEquals(emptyList<StreamEvent>(), p.feed(bytes.copyOfRange(0, cut)))
        assertEquals(listOf(StreamEvent.Delta("héllo")), p.feed(bytes.copyOfRange(cut, bytes.size)))
    }

    @Test fun `SseParser skips comments and malformed frames`() {
        val out = SseParser().feed(": ping\n\ndata: {oops\n\ndata: {\"type\":\"delta\",\"text\":\"ok\"}\n\n".toByteArray())
        assertEquals(listOf(StreamEvent.Delta("ok")), out)
    }

    @Test fun `SseParser parses a title event that arrives after done`() {
        val out = SseParser().feed(("data: {\"type\":\"done\",\"messageId\":\"m\"}\n\n" + "data: {\"type\":\"title\",\"title\":\"Lisbon trip\"}\n\n").toByteArray())
        assertEquals(listOf(StreamEvent.Done("m"), StreamEvent.Title("Lisbon trip")), out)
    }

    @Test fun `SseParser ignores event types it does not know`() {
        val out = SseParser().feed("data: {\"type\":\"future\",\"x\":1}\n\ndata: {\"type\":\"delta\",\"text\":\"ok\"}\n\n".toByteArray())
        assertEquals(listOf(StreamEvent.Delta("ok")), out)
    }
}

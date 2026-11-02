package dev.qarasky.zero

import dev.qarasky.zero.data.Activity
import dev.qarasky.zero.data.ChatMessage
import dev.qarasky.zero.data.ProviderConnection
import dev.qarasky.zero.data.ProviderInfo
import dev.qarasky.zero.data.Settings
import dev.qarasky.zero.data.SseParser
import dev.qarasky.zero.data.StreamEvent
import dev.qarasky.zero.data.ZeroJson
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContractJsonTest {
    @Test fun `models payload with provider status and the free flag parses`() {
        val json = """[{"id":"openrouter","name":"OpenRouter","connected":false,"status":"needs_connection","models":[]},
            {"id":"opencode","name":"OpenCode","connected":false,"status":"ready","models":[{"id":"m","name":"M","vision":false,"thinkingLevels":[],"isDefault":true,"free":true}]}]"""
        val ps = ZeroJson.decodeFromString(ListSerializer(ProviderInfo.serializer()), json)
        assertEquals("needs_connection", ps[0].status)
        assertTrue(ps[1].models.single().free)
    }

    @Test fun `an older payload without status or free still parses as ready and paid`() {
        val ps = ZeroJson.decodeFromString(ListSerializer(ProviderInfo.serializer()), """[{"id":"opencode","name":"O","connected":true,"models":[{"id":"m","name":"M","vision":false,"thinkingLevels":[],"isDefault":true}]}]""")
        assertEquals("ready", ps[0].status)
        assertFalse(ps[0].models[0].free)
    }

    @Test fun `provider connections carry the free-filter capability`() {
        val c = ZeroJson.decodeFromString(ListSerializer(ProviderConnection.serializer()), """[{"id":"openrouter","name":"OpenRouter","connected":true,"methods":["key"],"supportsFreeFilter":true},{"id":"openai","name":"Codex","connected":false,"methods":["key","signin"]}]""")
        assertTrue(c[0].supportsFreeFilter)
        assertFalse(c[1].supportsFreeFilter)
    }

    @Test fun `settings with and without the new provider lists round trip`() {
        val old = ZeroJson.decodeFromString(Settings.serializer(), """{"memoryEnabled":true,"displayName":"","tone":"","about":""}""")
        assertEquals(emptyList<String>(), old.disabledProviders)
        assertEquals(emptyList<String>(), old.freeOnlyProviders)
        val s = Settings(disabledProviders = listOf("openai"), freeOnlyProviders = listOf("opencode"))
        assertEquals(s, ZeroJson.decodeFromString(Settings.serializer(), ZeroJson.encodeToString(Settings.serializer(), s)))
        assertTrue(ZeroJson.encodeToString(Settings.serializer(), s).contains("freeOnlyProviders"))
    }

    @Test fun `messages carry their note activity and default to none`() {
        val m = ZeroJson.decodeFromString(ChatMessage.serializer(), """{"id":"1","role":"assistant","text":"hi","attachments":[],"sources":[],"activity":[{"kind":"read","title":"Budget","chat":"Lisbon"},{"kind":"saved","title":"Plan"}],"createdAt":1}""")
        assertEquals(listOf(Activity("read", "Budget", "Lisbon"), Activity("saved", "Plan")), m.activity)
        assertEquals(emptyList<Activity>(), ZeroJson.decodeFromString(ChatMessage.serializer(), """{"id":"1","role":"user","text":"x"}""").activity)
    }

    @Test fun `the new stream events parse`() {
        val out = SseParser().feed(
            ("data: {\"type\":\"activity\",\"kind\":\"saved\",\"title\":\"Plan\"}\n\n" +
                "data: {\"type\":\"activity\",\"kind\":\"read\",\"title\":\"Budget\",\"chat\":\"Lisbon\"}\n\n" +
                "data: {\"type\":\"approval\",\"id\":\"a1\",\"action\":\"edit\",\"chat\":\"Lisbon\"}\n\n" +
                "data: {\"type\":\"approval_closed\",\"id\":\"a1\",\"outcome\":\"expired\"}\n\n" +
                "data: {\"type\":\"error\",\"code\":\"model_not_allowed\",\"message\":\"no\"}\n\n").toByteArray(),
        )
        assertEquals(
            listOf(
                StreamEvent.Noted(Activity("saved", "Plan")), StreamEvent.Noted(Activity("read", "Budget", "Lisbon")),
                StreamEvent.Approval("a1", "edit", "Lisbon"), StreamEvent.ApprovalClosed("a1", "expired"),
                StreamEvent.Error("model_not_allowed", "no"),
            ),
            out,
        )
    }
}

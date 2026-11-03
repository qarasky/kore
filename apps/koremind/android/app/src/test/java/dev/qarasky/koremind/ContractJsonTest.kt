package dev.qarasky.koremind

import dev.qarasky.koremind.data.Activity
import dev.qarasky.koremind.data.ChatMessage
import dev.qarasky.koremind.data.Health
import dev.qarasky.koremind.data.ProviderConnection
import dev.qarasky.koremind.data.ProviderInfo
import dev.qarasky.koremind.data.Settings
import dev.qarasky.koremind.data.SseParser
import dev.qarasky.koremind.data.StreamEvent
import dev.qarasky.koremind.data.KoreMindJson
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContractJsonTest {
    @Test fun `health says whether Kore ID is on and has no password switch`() {
        val h = KoreMindJson.decodeFromString(Health.serializer(), """{"name":"koremind","version":"1","setupRequired":false,"sso":true}""")
        assertTrue(h.sso)
        assertFalse(h.setupRequired)
        // An old server that still sends passwordLogin must not break the newer client.
        val old = KoreMindJson.decodeFromString(Health.serializer(), """{"name":"koremind","version":"1","setupRequired":true,"sso":false,"passwordLogin":true}""")
        assertFalse(old.sso)
    }

    @Test fun `models payload with provider status and the free flag parses`() {
        val json = """[{"id":"openrouter","name":"OpenRouter","connected":false,"status":"needs_connection","models":[]},
            {"id":"opencode","name":"OpenCode","connected":false,"status":"ready","models":[{"id":"m","name":"M","vision":false,"thinkingLevels":[],"isDefault":true,"free":true}]}]"""
        val ps = KoreMindJson.decodeFromString(ListSerializer(ProviderInfo.serializer()), json)
        assertEquals("needs_connection", ps[0].status)
        assertTrue(ps[1].models.single().free)
    }

    @Test fun `an older payload without status or free still parses as ready and paid`() {
        val ps = KoreMindJson.decodeFromString(ListSerializer(ProviderInfo.serializer()), """[{"id":"opencode","name":"O","connected":true,"models":[{"id":"m","name":"M","vision":false,"thinkingLevels":[],"isDefault":true}]}]""")
        assertEquals("ready", ps[0].status)
        assertFalse(ps[0].models[0].free)
    }

    @Test fun `provider connections carry the free-filter capability`() {
        val c = KoreMindJson.decodeFromString(ListSerializer(ProviderConnection.serializer()), """[{"id":"openrouter","name":"OpenRouter","connected":true,"methods":["key"],"supportsFreeFilter":true,"recommended":true},{"id":"openai","name":"Codex","connected":false,"methods":["key","signin"]}]""")
        assertTrue(c[0].supportsFreeFilter)
        assertTrue(c[0].recommended)
        assertFalse(c[1].recommended)
        assertFalse(c[1].supportsFreeFilter)
    }

    @Test fun `settings with and without the new provider lists round trip`() {
        val old = KoreMindJson.decodeFromString(Settings.serializer(), """{"memoryEnabled":true,"displayName":"","tone":"","about":""}""")
        assertEquals(emptyList<String>(), old.disabledProviders)
        assertEquals(emptyList<String>(), old.freeOnlyProviders)
        val s = Settings(disabledProviders = listOf("openai"), freeOnlyProviders = listOf("opencode"))
        assertEquals(s, KoreMindJson.decodeFromString(Settings.serializer(), KoreMindJson.encodeToString(Settings.serializer(), s)))
        assertTrue(KoreMindJson.encodeToString(Settings.serializer(), s).contains("freeOnlyProviders"))
    }

    @Test fun `messages carry their note activity and default to none`() {
        val m = KoreMindJson.decodeFromString(ChatMessage.serializer(), """{"id":"1","role":"assistant","text":"hi","attachments":[],"sources":[],"activity":[{"kind":"read","title":"Budget","chat":"Lisbon"},{"kind":"saved","title":"Plan"}],"createdAt":1}""")
        assertEquals(listOf(Activity("read", "Budget", "Lisbon"), Activity("saved", "Plan")), m.activity)
        assertEquals(emptyList<Activity>(), KoreMindJson.decodeFromString(ChatMessage.serializer(), """{"id":"1","role":"user","text":"x"}""").activity)
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

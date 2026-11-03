package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ServerUrl
import dev.qarasky.korecalendar.data.normalizeServerUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerUrlTest {
    private fun ok(input: String, base: String, cleartext: Boolean) =
        assertEquals("for '$input'", ServerUrl(base, cleartext), normalizeServerUrl(input))

    @Test fun keepsHttpsAndDropsTrailingSlash() = ok("https://cal.example.com/", "https://cal.example.com", false)

    @Test fun uppercaseSchemeIsLowercased() = ok("HTTP://192.168.1.5:8080", "http://192.168.1.5:8080", true)

    @Test fun bareAddressesOnTheLocalNetworkGetHttp() {
        ok("192.168.1.5:8080", "http://192.168.1.5:8080", true)
        ok("localhost:8080", "http://localhost:8080", true)
        ok("nas.local", "http://nas.local", true)
        ok("nas.lan:8080", "http://nas.lan:8080", true)
        ok("nas", "http://nas", true)
        ok("[::1]:8080", "http://[::1]:8080", true)
    }

    @Test fun bareNamesGetHttps() = ok("cal.example.com", "https://cal.example.com", false)

    @Test fun whitespaceAndApiSuffixAreDropped() {
        ok("  https://cal.example.com/api  ", "https://cal.example.com", false)
        ok("https://cal.example.com/api/", "https://cal.example.com", false)
    }

    @Test fun keepsAPathPrefix() = ok("https://example.com/calendar/", "https://example.com/calendar", false)

    @Test fun rejectsWhatIsNotAnAddress() {
        for (bad in listOf("https://u:p@cal.example.com", "ftp://x", "", "   ", "http://", "https://a b", "https:///x", "javascript:alert(1)")) {
            assertNull("'$bad' should be rejected", normalizeServerUrl(bad))
        }
    }
}

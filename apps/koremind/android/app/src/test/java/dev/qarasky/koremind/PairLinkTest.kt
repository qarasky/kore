package dev.qarasky.koremind

import dev.qarasky.koremind.data.ApiException
import dev.qarasky.koremind.data.AuthResponse
import dev.qarasky.koremind.data.PairLink
import dev.qarasky.koremind.data.PairResult
import dev.qarasky.koremind.data.User
import dev.qarasky.koremind.data.pair
import dev.qarasky.koremind.data.parsePairLink
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairLinkTest {
    @Test fun `parses a code and one encoded address`() {
        val l = parsePairLink("koremind://pair?c=abc123&u=http%3A%2F%2F192.168.1.18%3A8787")
        assertEquals(PairLink("abc123", listOf("http://192.168.1.18:8787")), l)
    }

    @Test fun `keeps several addresses in order`() {
        val l = parsePairLink("koremind://pair?c=k&u=http%3A%2F%2F10.0.0.2%3A8787&u=http%3A%2F%2F100.64.0.5%3A8787&u=https%3A%2F%2Fkoremind.example.com")
        assertEquals(listOf("http://10.0.0.2:8787", "http://100.64.0.5:8787", "https://koremind.example.com"), l?.urls)
    }

    @Test fun `addresses without a scheme or with a trailing slash are normalized`() {
        val l = parsePairLink("koremind://pair?c=k&u=192.168.1.5%3A8787%2F")
        assertEquals(listOf("http://192.168.1.5:8787"), l?.urls)
    }

    @Test fun `surrounding whitespace is ignored and url-safe codes survive`() {
        assertEquals("a-b_c", parsePairLink("  koremind://pair?c=a-b_c&u=http%3A%2F%2Fh%3A1  \n")?.code)
    }

    @Test fun `a link without a code or without usable addresses is rejected`() {
        assertNull(parsePairLink("koremind://pair?u=http%3A%2F%2Fh%3A1"))
        assertNull(parsePairLink("koremind://pair?c=&u=http%3A%2F%2Fh%3A1"))
        assertNull(parsePairLink("koremind://pair?c=abc"))
        assertNull(parsePairLink("koremind://pair?c=abc&u=%20"))
    }

    @Test fun `wrong scheme or host and garbage are rejected`() {
        assertNull(parsePairLink("https://pair?c=abc&u=http%3A%2F%2Fh%3A1"))
        assertNull(parsePairLink("koremind://other?c=abc&u=http%3A%2F%2Fh%3A1"))
        assertNull(parsePairLink("hello"))
        assertNull(parsePairLink(""))
        assertNull(parsePairLink("koremind://pair?c=%zz&u=%"))
    }

    // ---- the flow ------------------------------------------------------------------------------
    private val auth = AuthResponse("tok", User("u1", "me@home.lan", true))
    private val link = PairLink("code1", listOf("http://a:1", "http://b:2"))

    @Test fun `uses the first address that answers and redeems against it`() = runBlocking {
        val tried = mutableListOf<String>()
        val r = pair(link, probe = { tried += it; it == "http://b:2" }, redeem = { url, code -> assertEquals("code1", code); assertEquals("http://b:2", url); auth })
        assertEquals(PairResult.Ok("http://b:2", auth), r)
        assertEquals(listOf("http://a:1", "http://b:2"), tried)
    }

    @Test fun `nothing reachable means unreachable and redeem is never called`() = runBlocking {
        val r = pair(link, probe = { false }, redeem = { _, _ -> error("must not redeem") })
        assertEquals(PairResult.Unreachable, r)
    }

    @Test fun `an unknown or expired code stops at once as invalid`() = runBlocking {
        var calls = 0
        val r = pair(link, probe = { true }, redeem = { _, _ -> calls++; throw ApiException(401, "bad_code", "no") })
        assertEquals(PairResult.Invalid, r)
        assertEquals(1, calls)
    }

    @Test fun `a network failure while redeeming moves on to the next address`() = runBlocking {
        val r = pair(link, probe = { true }, redeem = { url, _ -> if (url == "http://a:1") throw ApiException(0, "unreachable", "down") else auth })
        assertTrue(r is PairResult.Ok && r.url == "http://b:2")
    }
}

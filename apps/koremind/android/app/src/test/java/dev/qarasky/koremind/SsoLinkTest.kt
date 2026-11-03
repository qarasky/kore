package dev.qarasky.koremind

import dev.qarasky.koremind.data.Pkce
import dev.qarasky.koremind.data.SsoLink
import dev.qarasky.koremind.data.parseSsoLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SsoLinkTest {
    @Test fun `PKCE challenge matches the RFC 7636 example`() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", Pkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun `verifier is url-safe and long enough`() {
        val v = Pkce.newVerifier()
        assertTrue(Regex("^[A-Za-z0-9_-]{64}$").matches(v))
        assertTrue(Regex("^[A-Za-z0-9_-]{43}$").matches(Pkce.challenge(v)))
    }

    @Test fun `parses a ticket, an error and linked`() {
        assertEquals(SsoLink.Ticket("abc_-1"), parseSsoLink("koremind://sso?ticket=abc_-1"))
        assertEquals(SsoLink.Error("denied"), parseSsoLink("koremind://sso?error=denied"))
        assertEquals(SsoLink.Linked, parseSsoLink("koremind://sso?linked=1"))
    }

    @Test fun `ignores anything else`() {
        assertNull(parseSsoLink("koremind://pair?c=x"))
        assertNull(parseSsoLink("koremind://sso?ticket="))
        assertNull(parseSsoLink("https://evil.example/sso?ticket=x"))
        assertNull(parseSsoLink("koremind://sso"))
    }
}

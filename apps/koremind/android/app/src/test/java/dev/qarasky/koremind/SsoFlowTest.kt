package dev.qarasky.koremind

import dev.qarasky.koremind.data.KoreMindJson
import dev.qarasky.koremind.data.LogoutResponse
import dev.qarasky.koremind.data.SsoAction
import dev.qarasky.koremind.data.SsoLink
import dev.qarasky.koremind.data.User
import dev.qarasky.koremind.data.logoutBrowserUrl
import dev.qarasky.koremind.data.parseSsoLink
import dev.qarasky.koremind.data.ssoAction
import dev.qarasky.koremind.data.ssoErrorMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SsoFlowTest {
    @Test fun `linked=1 while signed in reloads the account, never signs in`() {
        assertEquals(SsoAction.LinkDone, ssoAction(parseSsoLink("koremind://sso?linked=1")!!, signedIn = true))
        assertEquals(SsoAction.Ignore, ssoAction(SsoLink.Linked, signedIn = false))
    }

    @Test fun `a ticket only signs in when signed out`() {
        assertEquals(SsoAction.Exchange("t1"), ssoAction(SsoLink.Ticket("t1"), signedIn = false))
        assertEquals(SsoAction.Ignore, ssoAction(SsoLink.Ticket("t1"), signedIn = true))
    }

    @Test fun `errors keep their code and say whether it was a link`() {
        assertEquals(SsoAction.Fail("sub_taken", linking = true), ssoAction(parseSsoLink("koremind://sso?error=sub_taken")!!, signedIn = true))
        assertEquals(SsoAction.Fail("denied", linking = false), ssoAction(parseSsoLink("koremind://sso?error=denied")!!, signedIn = false))
    }

    @Test fun `error codes map to their own messages, unknown ones to the generic one`() {
        val codes = listOf("denied", "invalid_state", "no_email", "not_allowed", "owner_pending", "account_exists", "sub_taken", "already_linked", "unavailable")
        val messages = codes.map(::ssoErrorMessage)
        assertEquals(codes.size, messages.toSet().size)
        assertFalse(R.string.sso_failed in messages)
        assertEquals(R.string.sso_error_sub_taken, ssoErrorMessage("sub_taken"))
        assertEquals(R.string.sso_failed, ssoErrorMessage("provider_error"))
        assertEquals(R.string.sso_failed, ssoErrorMessage("something_new"))
    }

    @Test fun `logout response with and without a Kore ID logout URL`() {
        val withUrl = KoreMindJson.decodeFromString(LogoutResponse.serializer(), """{"ok":true,"logoutUrl":"https://id.example/logout?id_token_hint=x"}""")
        assertEquals("https://id.example/logout?id_token_hint=x", logoutBrowserUrl(withUrl))
        val plain = KoreMindJson.decodeFromString(LogoutResponse.serializer(), """{"ok":true}""")
        assertTrue(plain.ok)
        assertNull(logoutBrowserUrl(plain))
        assertNull(logoutBrowserUrl(null))
    }

    @Test fun `only http(s) logout URLs are opened`() {
        assertNull(logoutBrowserUrl(LogoutResponse(logoutUrl = "javascript:alert(1)")))
        assertNull(logoutBrowserUrl(LogoutResponse(logoutUrl = "koremind://sso?ticket=x")))
        assertNull(logoutBrowserUrl(LogoutResponse(logoutUrl = "  ")))
        assertEquals("http://lan.local/logout", logoutBrowserUrl(LogoutResponse(logoutUrl = " http://lan.local/logout ")))
    }

    @Test fun `me reads ssoLinked and defaults to not linked`() {
        assertTrue(KoreMindJson.decodeFromString(User.serializer(), """{"id":"u","email":"a@b.c","isOwner":true,"ssoLinked":true}""").ssoLinked)
        assertFalse(KoreMindJson.decodeFromString(User.serializer(), """{"id":"u","email":"a@b.c","isOwner":false}""").ssoLinked)
    }
}

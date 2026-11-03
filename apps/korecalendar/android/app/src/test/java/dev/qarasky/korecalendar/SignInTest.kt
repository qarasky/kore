package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Account
import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Session
import dev.qarasky.korecalendar.data.SignIn
import dev.qarasky.korecalendar.data.SignInResult
import dev.qarasky.korecalendar.data.TokenCreated
import dev.qarasky.korecalendar.data.User
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SignInTest {
    private val kv = MapKeyValue()
    private val accounts = AccountStore(kv, ReversingBox())
    private val api = FakeApi()
    private val tokensUsed = mutableListOf<String?>()
    private val signIn = SignIn({ _, token -> tokensUsed += token; api }, accounts, "Pixel 9")

    private fun happyServer() {
        api.onLogin = { _, _ -> Session("session-token", User("u1", "me@example.com", "admin", "Europe/Berlin")) }
        api.onCreateToken = { TokenCreated("t1", it, "kcal_app_token") }
    }

    @Test fun makesItsOwnTokenAndEndsTheSession() = runTest {
        happyServer()
        val r = signIn.signIn("https://cal.example.com/", "me@example.com", "my-secret-password") as SignInResult.Ok
        assertEquals(listOf("login", "createToken:Android, Pixel 9", "logout"), api.calls)
        assertEquals(listOf(null, "session-token"), tokensUsed) // login without a token; the rest with the session
        assertEquals(Account("https://cal.example.com", "u1", "me@example.com", "Europe/Berlin", "kcal_app_token"), r.account)
        assertEquals(r.account, accounts.load())
        assertEquals(false, r.cleartext)
    }

    @Test fun neitherThePasswordNorTheSessionTokenIsKept() = runTest {
        happyServer()
        signIn.signIn("https://cal.example.com", "me@example.com", "my-secret-password")
        assertTrue(kv.map.values.none { it.contains("my-secret-password") || it.contains("session-token") })
    }

    @Test fun anHttpAddressIsAllowedAndFlagged() = runTest {
        happyServer()
        val r = signIn.signIn("192.168.1.5:8080", "me@example.com", "pw-pw-pw-pw") as SignInResult.Ok
        assertEquals(true, r.cleartext)
        assertEquals("http://192.168.1.5:8080", r.account.serverUrl)
    }

    @Test fun aBadAddressMakesNoRequest() = runTest {
        assertEquals(SignInResult.BadUrl, signIn.signIn("ftp://nope", "a@b.c", "pw"))
        assertTrue(api.calls.isEmpty())
        assertNull(accounts.load())
    }

    @Test fun wrongCredentials() = runTest {
        api.onLogin = { _, _ -> throw ApiException(401, "unauthorized", "Wrong email or password.") }
        assertEquals(SignInResult.BadCredentials, signIn.signIn("https://cal.example.com", "a@b.c", "pw"))
        assertNull(accounts.load())
    }

    @Test fun rateLimited() = runTest {
        api.onLogin = { _, _ -> throw ApiException(429, "rate_limited", "Try again in 15 minutes.") }
        val r = signIn.signIn("https://cal.example.com", "a@b.c", "pw") as SignInResult.RateLimited
        assertEquals("Try again in 15 minutes.", r.message)
    }

    @Test fun offline() = runTest {
        api.onLogin = { _, _ -> throw NetworkException("no route") }
        assertEquals(SignInResult.Offline, signIn.signIn("https://cal.example.com", "a@b.c", "pw"))
        assertNull(accounts.load())
    }

    @Test fun anAnswerThatIsNotTheApiIsAFailure() = runTest {
        api.onLogin = { _, _ -> throw ApiException(502, "bad_response", "Unexpected answer from the server (HTTP 502).") }
        assertTrue(signIn.signIn("https://cal.example.com", "a@b.c", "pw") is SignInResult.Failed)
    }

    @Test fun ifMakingTheTokenFailsNothingIsSavedAndTheSessionIsEnded() = runTest {
        api.onLogin = { _, _ -> Session("session-token", User("u1", "me@example.com", "user", "UTC")) }
        api.onCreateToken = { throw ApiException(500, "internal", "boom") }
        assertTrue(signIn.signIn("https://cal.example.com", "a@b.c", "pw") is SignInResult.Failed)
        assertNull(accounts.load())
        assertEquals(listOf("login", "createToken:Android, Pixel 9", "logout"), api.calls)
    }
}

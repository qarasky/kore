package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Account
import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.AuthConfig
import dev.qarasky.korecalendar.data.HttpKoreId
import dev.qarasky.korecalendar.data.KOREID_CLIENT_ID
import dev.qarasky.korecalendar.data.KOREID_REDIRECT_URI
import dev.qarasky.korecalendar.data.KoreIdEndpoints
import dev.qarasky.korecalendar.data.KoreIdException
import dev.qarasky.korecalendar.data.KoreIdProvider
import dev.qarasky.korecalendar.data.KoreIdRedirect
import dev.qarasky.korecalendar.data.KoreIdRedirects
import dev.qarasky.korecalendar.data.OidcInfo
import dev.qarasky.korecalendar.data.Pkce
import dev.qarasky.korecalendar.data.SignIn
import dev.qarasky.korecalendar.data.SignInResult
import dev.qarasky.korecalendar.data.TokenCreated
import dev.qarasky.korecalendar.data.User
import dev.qarasky.korecalendar.data.koreIdAuthorizationUrl
import dev.qarasky.korecalendar.data.parseKoreIdRedirect
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class KoreIdTest {
    private val issuer = "https://id.kore.example"
    private val endpoints = KoreIdEndpoints("$issuer/authorize", "$issuer/token")

    @Test fun pkceChallengeIsTheS256OfTheVerifier() {
        // RFC 7636 appendix B.
        val p = Pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "s")
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", p.challenge)
    }

    @Test fun generatedSecretsAreLongAndFresh() {
        val a = Pkce.generate()
        val b = Pkce.generate()
        assertTrue(a.verifier.length in 43..128)
        assertTrue(a.state.length >= 22)
        assertNotEquals(a.verifier, b.verifier)
        assertNotEquals(a.state, b.state)
    }

    @Test fun authorizationUrlCarriesPkceAndTheRegisteredRedirect() {
        val p = Pkce.generate()
        val url = koreIdAuthorizationUrl(endpoints, p)
        val q = URI(url).rawQuery.split('&').associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8") }
        assertTrue(url.startsWith("$issuer/authorize?"))
        assertEquals("code", q["response_type"])
        assertEquals(KOREID_CLIENT_ID, q["client_id"])
        assertEquals(KOREID_REDIRECT_URI, q["redirect_uri"])
        assertEquals("S256", q["code_challenge_method"])
        assertEquals(p.challenge, q["code_challenge"])
        assertEquals(p.state, q["state"])
        assertFalse(url.contains(p.verifier))
    }

    @Test fun redirectWithTheRightStateGivesTheCode() {
        val p = Pkce.generate()
        val r = parseKoreIdRedirect("$KOREID_REDIRECT_URI?code=abc%2B1&state=${p.state}&iss=$issuer", p, issuer)
        assertEquals(KoreIdRedirect.Code("abc+1"), r)
    }

    @Test fun redirectsThatDoNotBelongToThisSignInAreRefused() {
        val p = Pkce.generate()
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("$KOREID_REDIRECT_URI?code=abc&state=other", p, issuer))
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("$KOREID_REDIRECT_URI?code=abc", p, issuer))
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("$KOREID_REDIRECT_URI?code=abc&state=${p.state}&iss=https://evil.example", p, issuer))
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("$KOREID_REDIRECT_URI?state=${p.state}", p, issuer))
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("dev.qarasky.korecalendar:/elsewhere?code=abc&state=${p.state}", p, issuer))
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("https://evil.example/oauth2redirect?code=abc&state=${p.state}", p, issuer))
        assertEquals(KoreIdRedirect.Invalid, parseKoreIdRedirect("not a url", p, issuer))
    }

    @Test fun aDeniedRequestIsReportedAsSuch() {
        val p = Pkce.generate()
        assertEquals(KoreIdRedirect.Denied("access_denied"), parseKoreIdRedirect("$KOREID_REDIRECT_URI?error=access_denied&state=${p.state}", p, issuer))
    }

    @Test fun redirectsReachOnlyAWaitingSignIn() = runTest {
        assertFalse(KoreIdRedirects.deliver("$KOREID_REDIRECT_URI?code=x"))
        val waiting = KoreIdRedirects.expect()
        assertTrue(KoreIdRedirects.deliver("$KOREID_REDIRECT_URI?code=x"))
        assertEquals("$KOREID_REDIRECT_URI?code=x", waiting.await())
    }

    // ---- the whole sign-in, with a scripted provider ----

    private class FakeProvider(val endpoints: KoreIdEndpoints) : KoreIdProvider {
        var exchanged: Triple<String, Pkce, Unit>? = null
        override suspend fun discover(issuer: String) = endpoints
        override suspend fun exchange(endpoints: KoreIdEndpoints, code: String, pkce: Pkce): String {
            exchanged = Triple(code, pkce, Unit)
            return "kore-access-token"
        }
    }

    private val kv = MapKeyValue()
    private val accounts = AccountStore(kv, ReversingBox())
    private val api = FakeApi()
    private val tokensUsed = mutableListOf<String?>()
    private val provider = FakeProvider(endpoints)
    private val signIn = SignIn({ _, token -> tokensUsed += token; api }, accounts, "Pixel 9", provider)

    private fun serverOffersKoreId() {
        api.onAuthConfig = { AuthConfig(oidc = OidcInfo("Kore ID", issuer)) }
        api.onMe = { User("u1", "me@example.com", "user", "Europe/Berlin") }
        api.onCreateToken = { TokenCreated("t1", it, "kcal_app_token") }
    }

    /** A browser that signs in at once: reads state from the URL and redirects back. */
    private fun cooperativeBrowser(extra: String = ""): suspend (String) -> String = { url ->
        val state = URLDecoder.decode(URI(url).rawQuery.split('&').first { it.startsWith("state=") }.substringAfter('='), "UTF-8")
        "$KOREID_REDIRECT_URI?code=the-code&state=$state&iss=$issuer$extra"
    }

    @Test fun koreIdSignInEndsWithTheAppsOwnTokenAndKeepsNoKoreIdToken() = runTest {
        serverOffersKoreId()
        val r = signIn.signInWithKoreId("https://cal.example.com", cooperativeBrowser()) as SignInResult.Ok
        assertEquals(Account("https://cal.example.com", "u1", "me@example.com", "Europe/Berlin", "kcal_app_token"), r.account)
        assertEquals(r.account, accounts.load())
        assertEquals(listOf(null, "kore-access-token"), tokensUsed) // config without a token, then me + createToken with the Kore ID one
        assertEquals(listOf("authConfig", "me", "createToken:Android, Pixel 9"), api.calls)
        assertEquals("the-code", provider.exchanged?.first)
        assertTrue(kv.map.values.none { it.contains("kore-access-token") })
    }

    @Test fun aServerWithoutKoreId() = runTest {
        assertEquals(SignInResult.NoKoreId, signIn.signInWithKoreId("https://cal.example.com") { fail("browser opened"); "" })
        assertNull(accounts.load())
    }

    @Test fun aForgedRedirectIsRefusedBeforeTheCodeIsUsed() = runTest {
        serverOffersKoreId()
        val r = signIn.signInWithKoreId("https://cal.example.com") { "$KOREID_REDIRECT_URI?code=stolen&state=wrong" }
        assertTrue(r is SignInResult.Failed)
        assertNull(provider.exchanged)
        assertNull(accounts.load())
    }

    @Test fun cancellingInTheBrowser() = runTest {
        serverOffersKoreId()
        val r = signIn.signInWithKoreId("https://cal.example.com") { url ->
            val state = URLDecoder.decode(URI(url).rawQuery.split('&').first { it.startsWith("state=") }.substringAfter('='), "UTF-8")
            "$KOREID_REDIRECT_URI?error=access_denied&state=$state"
        }
        assertEquals(SignInResult.Cancelled, r)
        assertNull(accounts.load())
    }

    @Test fun anApiRefusalMeansNothingIsSaved() = runTest {
        serverOffersKoreId()
        api.onMe = { throw ApiException(401, "unauthorized", "authentication required") }
        assertTrue(signIn.signInWithKoreId("https://cal.example.com", cooperativeBrowser()) is SignInResult.Failed)
        assertNull(accounts.load())
    }

    // ---- HTTP side ----

    @Test fun discoveryAndTheTokenExchange() = runTest {
        MockWebServer().use { server ->
            server.start()
            val iss = server.url("/").toString().trimEnd('/')
            server.enqueue(MockResponse().setBody("""{"issuer":"$iss","authorization_endpoint":"$iss/authorize","token_endpoint":"$iss/token"}"""))
            server.enqueue(MockResponse().setBody("""{"access_token":"at","id_token":"idt","token_type":"Bearer"}"""))
            val kore = HttpKoreId()
            val ep = kore.discover(iss)
            assertEquals("$iss/token", ep.token)
            val pkce = Pkce("v".repeat(43), "state")
            assertEquals("at", kore.exchange(ep, "the-code", pkce))
            server.takeRequest()
            val form = server.takeRequest().body.readUtf8()
            assertTrue(form.contains("grant_type=authorization_code") && form.contains("code=the-code") && form.contains("code_verifier=${"v".repeat(43)}"))
            assertTrue(form.contains("client_id=$KOREID_CLIENT_ID") && !form.contains("client_secret"))
        }
    }

    @Test fun discoveryForADifferentIssuerIsRefused() = runTest {
        MockWebServer().use { server ->
            server.start()
            server.enqueue(MockResponse().setBody("""{"issuer":"https://evil.example","authorization_endpoint":"x","token_endpoint":"y"}"""))
            try {
                HttpKoreId().discover(server.url("/").toString().trimEnd('/'))
                fail("accepted")
            } catch (_: KoreIdException) {
            }
        }
    }
}

package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.normalizeServerUrl
import java.time.Instant
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class HttpApiTest {
    private lateinit var server: MockWebServer

    @Before fun start() { server = MockWebServer().also { it.start() } }
    @After fun stop() { server.shutdown() }

    private fun api(token: String? = null) = HttpApi(normalizeServerUrl(server.url("/").toString())!!, token)
    private fun json(status: Int, body: String) = MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body)

    @Test fun loginPostsCredentialsWithoutAuthorization() = runTest {
        server.enqueue(json(200, """{"token":"sess","user":{"id":"u","email":"a@b.c","role":"user","timezone":"Europe/Berlin"}}"""))
        val s = api().login("a@b.c", "secret-password")
        assertEquals("sess", s.token)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/login", req.path)
        assertNull(req.getHeader("Authorization"))
        assertTrue(req.body.readUtf8().let { it.contains("\"email\":\"a@b.c\"") && it.contains("\"password\":\"secret-password\"") })
    }

    @Test fun authenticatedCallsSendTheBearerToken() = runTest {
        server.enqueue(json(200, """[{"id":"c1","name":"Work","color":"#7b6cf0","created_at":1}]"""))
        val cals = api("kcal_abc").calendars()
        assertEquals("Work", cals.single().name)
        val req = server.takeRequest()
        assertEquals("Bearer kcal_abc", req.getHeader("Authorization"))
        assertEquals("/api/calendars", req.path)
    }

    @Test fun occurrencesSendsRfc3339UtcBounds() = runTest {
        server.enqueue(json(200, "[]"))
        api("t").occurrences(Instant.parse("2026-11-02T00:00:00.789Z"), Instant.parse("2026-12-02T00:00:00Z"))
        val path = server.takeRequest().path!!
        assertTrue(path, path.startsWith("/api/occurrences?"))
        assertTrue(path, path.contains("from=2026-11-02T00%3A00%3A00Z") || path.contains("from=2026-11-02T00:00:00Z"))
        assertTrue(path, path.contains("to=2026-12-02T00%3A00%3A00Z") || path.contains("to=2026-12-02T00:00:00Z"))
    }

    @Test fun changesSendsTheCursor() = runTest {
        server.enqueue(json(200, """{"cursor":7,"upserted":[],"deleted":[],"more":false}"""))
        assertEquals(7L, api("t").changes(5).cursor)
        assertEquals("/api/changes?since=5", server.takeRequest().path)
    }

    @Test fun createTokenAndLogout() = runTest {
        server.enqueue(json(201, """{"id":"t1","name":"Android, Pixel","token":"kcal_secret"}"""))
        server.enqueue(MockResponse().setResponseCode(204))
        val a = api("sess")
        assertEquals("kcal_secret", a.createToken("Android, Pixel").token)
        a.logout()
        val create = server.takeRequest()
        assertEquals("/api/tokens", create.path)
        assertTrue(create.body.readUtf8().contains("\"name\":\"Android, Pixel\""))
        assertEquals("/api/logout", server.takeRequest().path)
    }

    @Test fun anErrorBodyBecomesAnApiException() = runTest {
        server.enqueue(json(401, """{"error":{"code":"unauthorized","message":"Sign in first."}}"""))
        val e = assertThrows(ApiException::class.java) { kotlinx.coroutines.runBlocking { api("bad").me() } }
        assertEquals(401, e.status)
        assertEquals("unauthorized", e.code)
        assertEquals("Sign in first.", e.message)
    }

    @Test fun rateLimitKeepsItsCode() = runTest {
        server.enqueue(json(429, """{"error":{"code":"rate_limited","message":"Try again later."}}"""))
        val e = assertThrows(ApiException::class.java) { kotlinx.coroutines.runBlocking { api().login("a@b.c", "x") } }
        assertEquals("rate_limited", e.code)
    }

    @Test fun aDroppedConnectionIsANetworkException() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        assertThrows(NetworkException::class.java) { kotlinx.coroutines.runBlocking { api("t").me() } }
    }

    @Test fun aNonJsonGatewayErrorDoesNotCrashTheParser() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad gateway</html>"))
        val e = assertThrows(ApiException::class.java) { kotlinx.coroutines.runBlocking { api("t").me() } }
        assertEquals(502, e.status)
        assertEquals("bad_response", e.code)
    }
}

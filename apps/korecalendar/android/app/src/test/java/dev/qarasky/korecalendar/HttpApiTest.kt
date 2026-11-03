package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.WriteRequest
import dev.qarasky.korecalendar.data.normalizeServerUrl
import java.time.Instant
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

    // --- writes ----------------------------------------------------------------------------------

    private val eventJson = """{"id":"e1","calendar_id":"c1","title":"Gym","notes":"n","location":"Park","start":"2026-11-04T16:00:00","end":"2026-11-04T17:00:00","tz":"Europe/Berlin","all_day":false,"rrule":"FREQ=WEEKLY;BYDAY=WE","rdates":[],"exdates":["2026-11-11T16:00:00"],"reminders":[{"minutes_before":30}],"version":4}"""

    @Test fun readsAWholeEvent() = runTest {
        server.enqueue(json(200, eventJson))
        val e = api("t").event("e1")
        assertEquals("/api/events/e1", server.takeRequest().path)
        assertEquals(4, e.version)
        assertEquals("FREQ=WEEKLY;BYDAY=WE", e.rrule)
        assertEquals(listOf("2026-11-11T16:00:00"), e.exdates)
        assertEquals(30, e.reminders.single().minutesBefore)
        assertEquals("Europe/Berlin", e.tz)
    }

    @Test fun aCreateSendsTheBodyAndTheIdempotencyKey() = runTest {
        server.enqueue(json(201, eventJson))
        val body = JsonObject(mapOf("title" to JsonPrimitive("Gym")))
        val r = api("t").write(WriteRequest("POST", "/api/events", body, null, "key-1"))
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/events", req.path)
        assertEquals("key-1", req.getHeader("Idempotency-Key"))
        assertNull(req.getHeader("If-Match"))
        assertEquals("""{"title":"Gym"}""", req.body.readUtf8())
        assertEquals("e1", r.event.id)
    }

    @Test fun anEditSendsIfMatchAndKeepsTheEncodedQuery() = runTest {
        server.enqueue(json(200, eventJson))
        api("t").write(WriteRequest("PATCH", "/api/events/e1?scope=this&occurrence=2026-11-11T16%3A00%3A00", JsonObject(mapOf("title" to JsonPrimitive("x"))), 4, null))
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("/api/events/e1?scope=this&occurrence=2026-11-11T16%3A00%3A00", req.path)
        assertEquals("\"4\"", req.getHeader("If-Match"))
        assertNull(req.getHeader("Idempotency-Key"))
    }

    @Test fun aDeleteHasNoBody() = runTest {
        server.enqueue(json(200, eventJson.replace("\"version\":4", "\"version\":5,\"deleted_at\":99")))
        val r = api("t").write(WriteRequest("DELETE", "/api/events/e1", null, 4, null))
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals(0L, req.bodySize)
        assertEquals(99L, r.event.deletedAt)
    }

    @Test fun anEditResultCarriesTheSplitAndTheDroppedOverrides() = runTest {
        val created = eventJson.replace("\"id\":\"e1\"", "\"id\":\"e2\"")
        server.enqueue(json(200, eventJson.dropLast(1) + ""","created":$created,"dropped_overrides":["2026-11-18T16:00:00","2026-11-25T16:00:00"]}"""))
        val r = api("t").write(WriteRequest("PATCH", "/api/events/e1?scope=following&occurrence=x", JsonObject(emptyMap()), 4, null))
        assertEquals("e2", r.created?.id)
        assertEquals(2, r.dropped.size)
    }

    @Test fun restoreIsAPostToTheRestorePath() = runTest {
        server.enqueue(json(200, eventJson))
        api("t").restoreEvent("e1")
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/events/e1/restore", req.path)
    }

    @Test fun aStaleVersionIsAVersionConflict() = runTest {
        server.enqueue(json(412, """{"error":{"code":"version_conflict","message":"stale"}}"""))
        val e = assertThrows(ApiException::class.java) { runBlocking { api("t").write(WriteRequest("PATCH", "/api/events/e1", JsonObject(emptyMap()), 3, null)) } }
        assertEquals(412, e.status)
        assertEquals("version_conflict", e.code)
    }
}

package dev.qarasky.korecalendar.contract

import dev.qarasky.korecalendar.FakeStore
import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.sync.SyncEngine
import dev.qarasky.korecalendar.sync.SyncResult
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The app's client and sync against the real server: the app's idea of the API cannot drift. */
class ContractTest {
    private lateinit var server: RunningServer

    @Before fun start() { server = ServerHarness.start() }
    @After fun stop() { if (::server.isInitialized) server.close() }

    private val today: LocalDate = LocalDate.now(ZoneOffset.UTC)

    private fun anon() = HttpApi(server.url, null)
    private fun withToken(t: String) = HttpApi(server.url, t)

    /** The app's own sign-in: password → session → its own access token → session ended. */
    private fun appToken(): Pair<String, String> = runBlocking {
        val session = anon().login(server.email, server.password)
        val api = withToken(session.token)
        val created = api.createToken("Android, test")
        api.logout()
        created.token to created.id
    }

    private fun seed(): Map<String, String> {
        val d1 = today.plusDays(1)
        val weekly = server.createEvent("""{"title":"Gym","start":"${d1}T16:00:00","end":"${d1}T17:00:00","tz":"Europe/Berlin","rrule":"FREQ=WEEKLY","reminders":[{"minutes_before":30}]}""")
        val weeklyId = weekly["id"]!!.jsonPrimitive.content
        val second = today.plusDays(8)
        server.json("PATCH", "/api/events/$weeklyId?scope=this&occurrence=${second}T16:00:00", """{"title":"Gym (moved)"}""")
        val allDay = server.createEvent("""{"title":"Holiday","start":"${today.plusDays(3)}","end":"${today.plusDays(4)}","all_day":true,"tz":"Europe/Berlin"}""")
        val doomed = server.createEvent("""{"title":"Doomed","start":"${today.plusDays(2)}T10:00:00","end":"${today.plusDays(2)}T11:00:00","tz":"UTC"}""")
        val doomedId = doomed["id"]!!.jsonPrimitive.content
        server.json("DELETE", "/api/events/$doomedId")
        return mapOf("weekly" to weeklyId, "allDay" to allDay["id"]!!.jsonPrimitive.content, "doomed" to doomedId)
    }

    @Test fun aWrongPasswordIsA401() = runBlocking {
        val e = assertThrows(ApiException::class.java) { runBlocking { anon().login(server.email, "not-the-password") } }
        assertEquals(401, e.status)
        val s = anon().login(server.email, server.password)
        assertTrue(s.user.timezone.isNotEmpty())
    }

    @Test fun theAppsSignInMakesItsOwnTokenAndEndsTheSession() = runBlocking {
        val session = anon().login(server.email, server.password)
        val sessionApi = withToken(session.token)
        val created = sessionApi.createToken("Android, test")
        assertTrue(created.token.startsWith("kcal_"))
        sessionApi.logout()
        // The session is over; the token works.
        assertThrows(ApiException::class.java) { runBlocking { sessionApi.me() } }.also { assertEquals(401, it.status) }
        val api = withToken(created.token)
        assertEquals(server.email, api.me().email)
        assertTrue(api.calendars().isNotEmpty())
    }

    @Test fun anAccessTokenCannotMakeTokens() = runBlocking {
        val (token, _) = appToken()
        val e = assertThrows(ApiException::class.java) { runBlocking { withToken(token).createToken("another") } }
        assertEquals(403, e.status)
    }

    @Test fun syncStoresExactlyWhatTheOccurrencesEndpointReturns() = runBlocking {
        seed()
        val (token, _) = appToken()
        val api = withToken(token)
        val store = FakeStore()
        val now = Instant.now()
        val result = SyncEngine(api, store, "owner") { now }.sync()
        assertTrue("sync result $result", result is SyncResult.Ok)
        val from = store.windowFrom()!!
        val direct = api.occurrences(from, from.plus(74, ChronoUnit.DAYS))
        val stored = store.snapshot().occurrences
        assertTrue(direct.isNotEmpty())
        assertEquals(direct.map { "${it.eventId}|${it.key}" }.sorted(), stored.map { "${it.eventId}|${it.key}" }.sorted())
        // The deleted event is not there; the exception is; the all-day event is a date.
        assertTrue(stored.none { it.title == "Doomed" })
        assertTrue(stored.any { it.title == "Gym (moved)" && it.isOverride })
        assertTrue(stored.count { it.title == "Gym" } >= 6)
        assertTrue(stored.single { it.title == "Holiday" }.allDay)
        assertEquals(1, store.snapshot().calendars.size)
    }

    @Test fun anEditAndADeletionReachThePhoneOnTheNextSync() = runBlocking {
        val ids = seed()
        val (token, _) = appToken()
        val store = FakeStore()
        var now = Instant.now()
        val engine = SyncEngine(withToken(token), store, "owner") { now }
        engine.sync()
        val cursor = store.cursor()

        server.json("PATCH", "/api/events/${ids.getValue("allDay")}", """{"title":"Holiday (edited)"}""")
        now = now.plusSeconds(60)
        assertEquals(SyncResult.Ok(changed = true), engine.sync())
        assertTrue(store.cursor() > cursor)
        assertTrue(store.snapshot().occurrences.any { it.title == "Holiday (edited)" })

        server.json("DELETE", "/api/events/${ids.getValue("weekly")}")
        now = now.plusSeconds(60)
        engine.sync()
        assertTrue(store.snapshot().occurrences.none { it.title.startsWith("Gym") })
    }

    @Test fun aRevokedTokenMakesTheNextSyncSignedOut() = runBlocking {
        seed()
        val (token, id) = appToken()
        val store = FakeStore()
        val engine = SyncEngine(withToken(token), store, "owner") { Instant.now() }
        assertTrue(engine.sync() is SyncResult.Ok)
        val before = store.snapshot().occurrences.size
        val (status, _) = server.call("DELETE", "/api/tokens/$id")
        assertEquals(204, status)
        assertEquals(SyncResult.SignedOut, engine.sync())
        assertEquals(before, store.snapshot().occurrences.size) // still readable
    }
}

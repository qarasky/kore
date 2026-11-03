package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Prefs
import dev.qarasky.korecalendar.data.Repository
import dev.qarasky.korecalendar.data.Session
import dev.qarasky.korecalendar.data.SignIn
import dev.qarasky.korecalendar.data.SignInResult
import dev.qarasky.korecalendar.data.TokenCreated
import dev.qarasky.korecalendar.data.User
import dev.qarasky.korecalendar.ui.AppController
import dev.qarasky.korecalendar.ui.AppState
import dev.qarasky.korecalendar.ui.Background
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppControllerTest {
    private class FakeBackground : Background {
        var scheduled = 0
        var cancelled = 0
        var widgetRefreshes = 0
        override fun scheduleSync() { scheduled++ }
        override fun cancelSync() { cancelled++ }
        override suspend fun refreshWidgets() { widgetRefreshes++ }
    }

    private val kv = MapKeyValue()
    private val accounts = AccountStore(kv, ReversingBox())
    private val prefs = Prefs(kv)
    private val store = FakeStore()
    private val repo = Repository(store)
    private val api = FakeApi()
    private val background = FakeBackground()
    private var now = Instant.parse("2026-11-04T10:00:00Z")
    private val signIn = SignIn({ _, _ -> api }, accounts, "Pixel")
    private val controller = AppController(accounts, prefs, store, repo, signIn, { _, _ -> api }, background) { now }

    private val cal = Calendar("c1", "Work", "#7b6cf0")
    private fun occ(id: String, cal: String = "c1") = Occurrence(
        eventId = id, calendarId = cal, key = id, title = id, start = "2026-11-04T12:00:00", end = "2026-11-04T13:00:00", tz = "UTC",
        startUtc = Instant.parse("2026-11-04T12:00:00Z"), endUtc = Instant.parse("2026-11-04T13:00:00Z"),
    )

    private fun serverWith(user: String = "u1", vararg events: Occurrence) {
        api.onLogin = { _, _ -> Session("sess", User(user, "me@example.com", "user", "Europe/Berlin")) }
        api.onCreateToken = { TokenCreated("t1", it, "kcal_app") }
        api.onCalendars = { listOf(cal, Calendar("c2", "Home", "#4caf50")) }
        api.onOccurrences = { from, _ -> if (from == Instant.parse("2026-10-21T00:00:00Z")) events.toList() else emptyList() }
    }

    private fun ready() = controller.state.value as AppState.Ready

    @Test fun withoutAnAccountItIsSignedOut() = runTest {
        controller.start()
        assertEquals(AppState.SignedOut("", "", revoked = false), controller.state.value)
    }

    @Test fun signingInRunsTheFirstSyncAndShowsTheAgenda() = runTest {
        serverWith("u1", occ("gym"))
        controller.start()
        val r = controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        assertTrue(r is SignInResult.Ok)
        assertEquals(listOf("gym"), ready().agenda.days.single().rows.map { it.item.occ.eventId })
        assertEquals(1, background.scheduled)
        assertTrue(background.widgetRefreshes >= 1)
    }

    @Test fun aRevokedTokenAsksToSignInAgainAndKeepsTheCopy() = runTest {
        serverWith("u1", occ("gym"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        api.onChanges = { throw ApiException(401, "unauthorized", "Sign in.") }
        now = now.plusSeconds(60)
        controller.refresh()
        assertEquals(AppState.SignedOut("https://cal.example.com", "me@example.com", revoked = true), controller.state.value)
        assertEquals(1, store.snapshot().occurrences.size) // kept for the widget
        // The same person signs in again: fine, the copy is simply refreshed.
        api.onChanges = { dev.qarasky.korecalendar.data.ChangeSet(cursor = 2) }
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        assertFalse(accounts.isRevoked())
        assertEquals(1, ready().agenda.days.single().rows.size)
    }

    @Test fun anotherAccountDoesNotInheritTheOldEvents() = runTest {
        serverWith("u1", occ("mine"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        api.onChanges = { throw ApiException(401, "unauthorized", "Sign in.") }
        controller.refresh()
        serverWith("u2") // a different person, with no events
        api.onChanges = { dev.qarasky.korecalendar.data.ChangeSet(cursor = 1) }
        controller.signIn("https://cal.example.com", "other@example.com", "pw-pw-pw-pw")
        assertTrue(store.snapshot().occurrences.isEmpty())
        assertEquals("u2", store.snapshot().accountId)
    }

    @Test fun refreshingOfflineKeepsTheAgendaAndSaysSo() = runTest {
        serverWith("u1", occ("gym"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        api.onCalendars = { throw NetworkException("down") }
        controller.refresh()
        val s = ready()
        assertTrue(s.agenda.offline)
        assertEquals(listOf("gym"), s.agenda.days.single().rows.map { it.item.occ.eventId })
    }

    @Test fun hidingACalendarUpdatesPrefsTheAgendaAndTheWidget() = runTest {
        serverWith("u1", occ("work", "c1"), occ("home", "c2"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        assertEquals(2, ready().agenda.days.single().rows.size)
        val before = background.widgetRefreshes
        controller.toggleCalendar("c2")
        assertEquals(setOf("c2"), prefs.hiddenCalendars)
        assertEquals(listOf("work"), ready().agenda.days.single().rows.map { it.item.occ.eventId })
        assertTrue(ready().calendars.single { it.calendar.id == "c2" }.hidden)
        assertTrue(background.widgetRefreshes > before)
        controller.toggleCalendar("c2")
        assertEquals(2, ready().agenda.days.single().rows.size)
    }

    @Test fun theClockPreferenceIsKeptAndShown() = runTest {
        serverWith("u1")
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        assertTrue(ready().clock24)
        controller.setClock24(false)
        assertFalse(ready().clock24)
        assertFalse(prefs.clock24)
    }

    @Test fun signingOutForgetsEverything() = runTest {
        serverWith("u1", occ("gym"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        controller.signOut()
        assertEquals(AppState.SignedOut("", "", revoked = false), controller.state.value)
        assertNull(accounts.load())
        assertTrue(store.snapshot().occurrences.isEmpty())
        assertEquals(1, background.cancelled)
        assertTrue(kv.map.values.none { it.contains("kcal_app") })
    }
}

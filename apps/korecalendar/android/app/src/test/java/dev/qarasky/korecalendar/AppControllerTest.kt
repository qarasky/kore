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
    private val controller = AppController(accounts, prefs, store, repo, signIn, { _, _ -> api }, background, TestMessages) { now }

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

    // --- editing

    @Test fun aNewEventStartsInTheNextFullHourInTheAccountsZoneWithTheFirstVisibleCalendar() = runTest {
        serverWith("u1", occ("gym"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        val f = controller.newEventForm()!!
        // 10:00 UTC is 11:00 in Berlin: the next full hour is 12:00.
        assertEquals(java.time.LocalDate.parse("2026-11-04"), f.startDay)
        assertEquals(java.time.LocalTime.of(12, 0), f.startTime)
        assertEquals(java.time.LocalTime.of(13, 0), f.endTime)
        assertEquals("Europe/Berlin", f.tz)
        assertEquals("c1", f.calendarId)
        controller.toggleCalendar("c1")
        assertEquals("c2", controller.newEventForm()!!.calendarId)
        // Another day starts at nine.
        assertEquals(java.time.LocalTime.of(9, 0), controller.newEventForm(java.time.LocalDate.parse("2026-11-09"))!!.startTime)
    }

    @Test fun theEditorOpensEvenBeforeTheCalendarsAreKnown() = runTest {
        serverWith("u1", occ("gym"))
        api.onCalendars = { emptyList() }
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        assertEquals("", controller.newEventForm()!!.calendarId)
        controller.beginNew()
        assertTrue(controller.editor.value != null)
    }

    @Test fun savingThroughTheEditorSyncsSoTheScreensAndTheWidgetAgree() = runTest {
        serverWith("u1", occ("gym"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        val refreshesBefore = background.widgetRefreshes
        val editor = controller.newEditor()!!
        editor.openNew(controller.newEventForm()!!.copy(title = "Dentist"))
        api.onWrite = { dev.qarasky.korecalendar.data.WriteResult(dev.qarasky.korecalendar.data.Event(id = "d1", title = "Dentist"), null, emptyList()) }
        api.calls.clear()
        assertEquals(dev.qarasky.korecalendar.edit.SaveResult.Saved("Event created"), editor.save(dev.qarasky.korecalendar.edit.Scope.All))
        assertTrue(api.calls.contains("changes"))
        assertTrue(background.widgetRefreshes > refreshesBefore)
    }

    @Test fun withoutAnAccountThereIsNoEditor() = runTest {
        controller.start()
        assertNull(controller.newEditor())
        assertNull(controller.newEventForm())
    }

    private suspend fun signedIn() {
        serverWith("u1", occ("gym"))
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
    }

    @Test fun beginningANewEventOpensTheEditorAndSavingPostsANotice() = runTest {
        signedIn()
        controller.beginNew()
        val editor = controller.editor.value!!
        editor.edit { it.copy(title = "Dentist") }
        api.onWrite = { dev.qarasky.korecalendar.data.WriteResult(dev.qarasky.korecalendar.data.Event(id = "d1", title = "Dentist"), null, emptyList()) }
        assertEquals(dev.qarasky.korecalendar.edit.SaveResult.Saved("Event created"), controller.save(dev.qarasky.korecalendar.edit.Scope.All))
        assertNull(controller.editor.value)
        assertEquals(dev.qarasky.korecalendar.ui.Notice("Event created", null), controller.notice.value)
        controller.dismissNotice()
        assertNull(controller.notice.value)
    }

    @Test fun aFailedSaveKeepsTheEditorOpen() = runTest {
        signedIn()
        controller.beginNew()
        controller.editor.value!!.edit { it.copy(title = "Dentist") }
        api.onWrite = { throw NetworkException("down") }
        assertEquals(dev.qarasky.korecalendar.edit.SaveResult.Failed, controller.save(dev.qarasky.korecalendar.edit.Scope.All))
        assertTrue(controller.editor.value != null)
        assertNull(controller.notice.value)
    }

    @Test fun cancellingTheEditorDiscardsIt() = runTest {
        signedIn()
        controller.beginNew()
        controller.endEdit()
        assertNull(controller.editor.value)
    }

    @Test fun deletingPostsANoticeThatCanBeUndone() = runTest {
        signedIn()
        val o = occ("gym")
        api.onEvent = { dev.qarasky.korecalendar.data.Event(id = "gym", title = "gym", version = 2) }
        api.onOccurrences = { _, _ -> listOf(o) }
        api.onWrite = { dev.qarasky.korecalendar.data.WriteResult(dev.qarasky.korecalendar.data.Event(id = "gym", deletedAt = 1), null, emptyList()) }
        controller.delete(o, dev.qarasky.korecalendar.edit.Scope.All)
        assertEquals(dev.qarasky.korecalendar.ui.Notice("Event deleted", "gym"), controller.notice.value)
        api.onRestore = { dev.qarasky.korecalendar.data.Event(id = "gym") }
        controller.undoDelete("gym")
        assertEquals(dev.qarasky.korecalendar.ui.Notice("Event restored", null), controller.notice.value)
    }

    @Test fun aFailedDeletePostsTheReason() = runTest {
        signedIn()
        api.onEvent = { throw NetworkException("down") }
        controller.delete(occ("gym"), dev.qarasky.korecalendar.edit.Scope.All)
        assertEquals(dev.qarasky.korecalendar.ui.Notice("Can't reach the server. Check your connection and try again.", null), controller.notice.value)
    }

    @Test fun signingOutClosesTheEditorAndClearsTheNotice() = runTest {
        signedIn()
        controller.beginNew()
        controller.signOut()
        assertNull(controller.editor.value)
        assertNull(controller.notice.value)
    }

    @Test fun afterElevenAtNightANewEventStartsAtMidnightTomorrowNotInThePast() = runTest {
        serverWith("u1", occ("gym"))
        now = Instant.parse("2026-11-04T22:30:00Z") // 23:30 in Berlin
        controller.start()
        controller.signIn("https://cal.example.com", "me@example.com", "pw-pw-pw-pw")
        val f = controller.newEventForm()!!
        assertEquals(java.time.LocalDate.parse("2026-11-05"), f.startDay)
        assertEquals(java.time.LocalTime.of(0, 0), f.startTime)
    }

    @Test fun deletingOneOccurrenceOffersNoUndo() = runTest {
        signedIn()
        api.onEvent = { dev.qarasky.korecalendar.data.Event(id = "gym", title = "gym", version = 2, rrule = "FREQ=DAILY") }
        api.onOccurrences = { _, _ -> listOf(occ("gym").copy(isRecurring = true)) }
        api.onWrite = { dev.qarasky.korecalendar.data.WriteResult(dev.qarasky.korecalendar.data.Event(id = "gym"), null, emptyList()) }
        controller.delete(occ("gym").copy(isRecurring = true), dev.qarasky.korecalendar.edit.Scope.This)
        assertEquals(dev.qarasky.korecalendar.ui.Notice("Event deleted", null), controller.notice.value)
    }
}

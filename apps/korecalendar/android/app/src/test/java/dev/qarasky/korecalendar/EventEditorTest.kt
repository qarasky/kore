package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Reminder
import dev.qarasky.korecalendar.data.WriteResult
import dev.qarasky.korecalendar.edit.DeleteResult
import dev.qarasky.korecalendar.edit.EditorState
import dev.qarasky.korecalendar.edit.EventEditor
import dev.qarasky.korecalendar.edit.Recurrence
import dev.qarasky.korecalendar.edit.SaveResult
import dev.qarasky.korecalendar.edit.Scope
import dev.qarasky.korecalendar.edit.newFormValues
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EventEditorTest {
    private val api = FakeApi()
    private var written = 0
    private var keys = 0
    private val editor = EventEditor(api, TestMessages, newKey = { "key-${++keys}" }, onWritten = { written++ })

    private val gym = Event(
        id = "g1", calendarId = "c1", title = "Gym", start = "2026-11-04T16:00:00", end = "2026-11-04T17:00:00", tz = "Europe/Berlin",
        rrule = "FREQ=WEEKLY;BYDAY=WE,FR", reminders = listOf(Reminder(30)), version = 3,
    )
    private fun occ(key: String = "2026-11-11T16:00:00", recurring: Boolean = true, id: String = "g1") = Occurrence(
        eventId = id, calendarId = "c1", key = key, title = "Gym", start = key, end = key.replace("T16:", "T17:"), tz = "Europe/Berlin",
        isRecurring = recurring, startUtc = Instant.parse("2026-11-11T15:00:00Z"), endUtc = Instant.parse("2026-11-11T16:00:00Z"),
    )
    private fun ok(e: Event = gym, dropped: List<String> = emptyList()) = WriteResult(e, null, dropped)
    private fun state() = editor.state.value as EditorState.Editing

    private val newForm get() = newFormValues(LocalDate.parse("2026-11-05"), LocalTime.of(9, 0), 60, false, "UTC", "c1").copy(title = "Dentist")

    @Test fun opensAnExistingEventFromTheServer() = runTest {
        api.onEvent = { gym }
        editor.openExisting(occ())
        assertEquals(listOf("event:g1"), api.calls)
        assertEquals("Gym", state().form.title)
        assertEquals(false, state().creating)
        assertEquals(true, state().recurring)
    }

    @Test fun aFailedLoadSaysWhy() = runTest {
        api.onEvent = { throw NetworkException("down") }
        editor.openExisting(occ())
        assertEquals("Can't reach the server. Check your connection and try again.", (editor.state.value as EditorState.LoadFailed).message)
    }

    @Test fun savingATitleOnlyEditWritesAndTellsTheAppToSync() = runTest {
        api.onEvent = { gym }
        api.onWrite = { ok() }
        editor.openExisting(occ())
        editor.edit { it.copy(title = "Gym 2") }
        val r = editor.save(Scope.All)
        assertEquals(SaveResult.Saved("Event saved"), r)
        assertEquals("/api/events/g1", api.writes.single().path)
        assertEquals(3, api.writes.single().ifMatch)
        assertEquals(1, written)
        assertEquals(EditorState.Closed, editor.state.value)
    }

    @Test fun aSaveWithNothingChangedSendsNothing() = runTest {
        api.onEvent = { gym }
        editor.openExisting(occ())
        assertEquals(SaveResult.Unchanged, editor.save(Scope.All))
        assertTrue(api.writes.isEmpty())
        assertEquals(0, written)
    }

    @Test fun invalidInputIsReportedAndNothingIsSent() = runTest {
        editor.openNew(newForm.copy(title = " "))
        assertEquals(SaveResult.Invalid, editor.save(Scope.All))
        assertEquals("editor_error_title", state().errors.title)
        assertTrue(api.writes.isEmpty())
        editor.edit { it.copy(title = "Dentist") }
        assertNull(state().errors.title)
    }

    @Test fun aFailedSaveKeepsEverythingTypedAndSaysWhy() = runTest {
        editor.openNew(newForm.copy(notes = "bring the card"))
        api.onWrite = { throw NetworkException("down") }
        assertEquals(SaveResult.Failed, editor.save(Scope.All))
        val s = state()
        assertEquals("bring the card", s.form.notes)
        assertEquals("Dentist", s.form.title)
        assertEquals("Can't reach the server. Check your connection and try again.", s.banner)
        assertEquals(false, s.saving)
        assertEquals(0, written)
    }

    @Test fun aRetryOfTheSameCreateReusesTheKeyAndAChangedFormTakesANewOne() = runTest {
        editor.openNew(newForm)
        api.onWrite = { throw NetworkException("down") }
        editor.save(Scope.All)
        editor.save(Scope.All)
        assertEquals(api.writes[0].idempotencyKey, api.writes[1].idempotencyKey)
        editor.edit { it.copy(title = "Dentist (changed)") }
        editor.save(Scope.All)
        assertNotEquals(api.writes[1].idempotencyKey, api.writes[2].idempotencyKey)
        api.onWrite = { ok(gym.copy(id = "new")) }
        assertEquals(SaveResult.Saved("Event created"), editor.save(Scope.All))
    }

    @Test fun aStaleVersionIsAConflictAndReloadShowsTheLatest() = runTest {
        api.onEvent = { gym }
        editor.openExisting(occ())
        editor.edit { it.copy(title = "Mine") }
        api.onWrite = { throw ApiException(412, "version_conflict", "stale") }
        assertEquals(SaveResult.Failed, editor.save(Scope.All))
        assertEquals(true, state().conflict)
        assertEquals("This event was changed somewhere else. Reload to see the latest.", state().banner)
        assertEquals("Mine", state().form.title) // still there until the person chooses
        api.onEvent = { gym.copy(title = "Theirs", version = 4) }
        api.onOccurrences = { _, _ -> listOf(occ().copy(title = "Theirs")) }
        editor.reload()
        assertEquals("Theirs", state().form.title)
        assertEquals(false, state().conflict)
        assertNull(state().banner)
    }

    @Test fun aSeriesEditThatResetChangedOccurrencesSaysSo() = runTest {
        api.onEvent = { gym }
        api.onWrite = { ok(dropped = listOf("2026-11-18T16:00:00", "2026-11-25T16:00:00")) }
        editor.openExisting(occ())
        editor.edit { it.copy(startDay = LocalDate.parse("2026-11-12"), endDay = LocalDate.parse("2026-11-12")) }
        assertEquals(SaveResult.Saved("Event saved. 2 changed occurrences no longer fit the new schedule and were reset."), editor.save(Scope.All))
    }

    @Test fun savingARepeatingEventOffersTheScopesThatAreSafeForTheChange() = runTest {
        api.onEvent = { gym }
        editor.openExisting(occ())
        editor.edit { it.copy(title = "x") }
        assertEquals(listOf(Scope.This, Scope.Following, Scope.All), editor.scopes())
        editor.edit { it.copy(tz = "UTC") }
        assertEquals(listOf(Scope.Following, Scope.All), editor.scopes())
        editor.edit { it.copy(recurrence = Recurrence.None) }
        assertEquals(listOf(Scope.Following, Scope.All), editor.scopes())
    }

    @Test fun deletingLoadsTheVersionThenDeletesAndSyncs() = runTest {
        api.onEvent = { gym }
        api.onWrite = { ok(gym.copy(deletedAt = 99)) }
        val r = editor.delete(occ(), Scope.This)
        assertEquals(DeleteResult.Deleted("Event deleted", "g1"), r)
        assertEquals("/api/events/g1?scope=this&occurrence=2026-11-11T16%3A00%3A00", api.writes.single().path)
        assertEquals("DELETE", api.writes.single().method)
        assertEquals(1, written)
    }

    @Test fun aFailedDeleteSaysWhy() = runTest {
        api.onEvent = { gym }
        api.onWrite = { throw ApiException(412, "version_conflict", "stale") }
        val r = editor.delete(occ(), Scope.All) as DeleteResult.Failed
        assertEquals("This event was changed somewhere else. Reload to see the latest.", r.message)
        assertEquals(0, written)
    }

    @Test fun undoRestoresAndSyncs() = runTest {
        api.onRestore = { gym }
        assertEquals("Event restored", editor.undo("g1"))
        assertEquals(listOf("restore:g1"), api.calls)
        assertEquals(1, written)
    }

    @Test fun aRepeatingOccurrenceOffersThreeDeleteScopesAndASingleEventOne() {
        assertEquals(listOf(Scope.This, Scope.Following, Scope.All), editor.deleteScopes(occ()))
        assertEquals(listOf(Scope.All), editor.deleteScopes(occ(recurring = false)))
    }
}

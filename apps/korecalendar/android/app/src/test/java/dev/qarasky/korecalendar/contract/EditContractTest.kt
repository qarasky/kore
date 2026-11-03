package dev.qarasky.korecalendar.contract

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.WriteResult
import dev.qarasky.korecalendar.edit.End
import dev.qarasky.korecalendar.edit.Freq
import dev.qarasky.korecalendar.edit.FormValues
import dev.qarasky.korecalendar.edit.MonthlyMode
import dev.qarasky.korecalendar.edit.Plan
import dev.qarasky.korecalendar.edit.Recurrence
import dev.qarasky.korecalendar.edit.Scope
import dev.qarasky.korecalendar.edit.droppedOverrides
import dev.qarasky.korecalendar.edit.formFromEvent
import dev.qarasky.korecalendar.edit.newFormValues
import dev.qarasky.korecalendar.edit.nextAttempt
import dev.qarasky.korecalendar.edit.planCreate
import dev.qarasky.korecalendar.edit.planDelete
import dev.qarasky.korecalendar.edit.planUpdate
import dev.qarasky.korecalendar.edit.validateForm
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneOffset
import java.time.temporal.TemporalAdjusters
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Every create / edit / delete / scope case of web/e2e/event-crud.spec.ts and recurring.spec.ts, run through
 * the phone's planner and client against the real server: the app's idea of the editing API cannot drift.
 */
class EditContractTest {
    private lateinit var server: RunningServer
    private lateinit var api: HttpApi
    private lateinit var workId: String
    private lateinit var firstId: String

    @Before fun start() = runBlocking {
        server = ServerHarness.start()
        server.json("PATCH", "/api/me", """{"timezone":"UTC"}""")
        val session = HttpApi(server.url, null).login(server.email, server.password)
        val s = HttpApi(server.url, session.token)
        val token = s.createToken("Android, test").token
        s.logout()
        api = HttpApi(server.url, token)
        workId = ApiJsonId(server.json("POST", "/api/calendars", """{"name":"Work","color":"#7b6cf0"}""", expect = 201))
        firstId = api.calendars().first { it.name != "Work" }.id
    }

    @After fun stop() { if (::server.isInitialized) server.close() }

    private fun ApiJsonId(o: kotlinx.serialization.json.JsonObject) = o["id"]!!.jsonPrimitive.content

    // --- the phone's editing flow, as the app runs it ---------------------------------------------

    private val today: LocalDate = LocalDate.now(ZoneOffset.UTC)

    /** A Wednesday at least a week from now, so nothing is in the past. */
    private val wed: LocalDate = today.plusDays(7).with(TemporalAdjusters.nextOrSame(DayOfWeek.WEDNESDAY))
    private fun wedIn(n: Int): LocalDate = wed.plusWeeks(n.toLong())
    private fun t(s: String) = LocalTime.parse(s)

    private fun blank(day: LocalDate = wed, start: String = "09:00") = newFormValues(day, t(start), 60, false, "UTC", firstId)

    private suspend fun send(plan: Plan, key: String? = null): List<WriteResult> =
        plan.requests.map { api.write(if (key != null) it.copy(idempotencyKey = key) else it) }

    private suspend fun create(form: FormValues): Event = send(planCreate(form), key = java.util.UUID.randomUUID().toString()).single().event

    private suspend fun occurrences(from: LocalDate, to: LocalDate): List<Occurrence> =
        api.occurrences(from.atStartOfDay().toInstant(ZoneOffset.UTC), to.atStartOfDay().toInstant(ZoneOffset.UTC))

    private suspend fun occurrenceOn(title: String, day: LocalDate): Occurrence? = occurrences(day, day.plusDays(1)).firstOrNull { it.title == title }

    /** Opens an occurrence the way the editor does: the whole series from the server plus the occurrence the person tapped. */
    private suspend fun open(occ: Occurrence): Pair<Event, Occurrence> = api.event(occ.eventId) to occ

    private suspend fun series(title: String): List<Triple<String, String, Boolean>> =
        occurrences(wedIn(0).minusDays(3), wedIn(9).plusDays(3)).filter { it.title.startsWith(title) }.map { Triple(it.title, it.start, it.isOverride) }

    // --- events: create, edit, delete ------------------------------------------------------------------

    @Test fun createAnEventWithEveryField() = runBlocking {
        val f = blank(wed, "14:00").copy(
            title = "Planning", endTime = t("15:30"), location = "Room 4", notes = "Bring the roadmap", tz = "Europe/Berlin", reminders = listOf(30), calendarId = workId,
        )
        val made = create(f)
        assertEquals("Planning", made.title)
        assertEquals("Room 4", made.location)
        assertEquals("Bring the roadmap", made.notes)
        assertEquals("${wed}T14:00:00", made.start)
        assertEquals("${wed}T15:30:00", made.end)
        assertEquals("Europe/Berlin", made.tz)
        assertEquals(workId, made.calendarId)
        assertEquals(listOf(30), made.reminders.map { it.minutesBefore })
        // 14:00 in Berlin is not 14:00 in UTC.
        val occ = occurrenceOn("Planning", wed)!!
        assertNotEquals("${wed}T14:00:00Z", occ.startUtc.toString())
    }

    @Test fun editAnEvent() = runBlocking {
        val made = create(blank(wed, "14:00").copy(title = "Planning", endTime = t("15:30"), location = "Room 4", notes = "Bring the roadmap", tz = "Europe/Berlin", reminders = listOf(30)))
        val (master, occ) = open(occurrenceOn("Planning", wed)!!)
        val form = formFromEvent(master, occ).copy(title = "Planning (moved)", startTime = t("16:00"), endTime = t("17:00"), location = "Room 7")
        send(planUpdate(master, occ, form, Scope.All))
        val after = api.event(made.id)
        assertEquals("Planning (moved)", after.title)
        assertEquals("${wed}T16:00:00", after.start)
        assertEquals("${wed}T17:00:00", after.end)
        assertEquals("Room 7", after.location)
        assertEquals("Bring the roadmap", after.notes)
        assertNull(occurrenceOn("Planning", wed))
    }

    @Test fun deleteAsksFirstAndUndoBringsTheEventBack() = runBlocking {
        val made = create(blank().copy(title = "Planning"))
        val (master, occ) = open(occurrenceOn("Planning", wed)!!)
        send(planDelete(master, occ, Scope.All))
        assertEquals(404, assertThrows(ApiException::class.java) { runBlocking { api.event(made.id) } }.status)
        assertNull(occurrenceOn("Planning", wed))
        api.restoreEvent(made.id)
        assertNull(api.event(made.id).deletedAt)
        assertNotNull(occurrenceOn("Planning", wed))
    }

    @Test fun anEndBeforeTheStartIsRefusedAndNothingIsSaved() = runBlocking {
        val before = occurrences(wed, wed.plusDays(1)).size
        val backwards = blank(wed, "15:00").copy(title = "Backwards", endTime = t("14:00"))
        assertEquals("editor_error_end_before_start", validateForm(backwards).end)
        assertEquals(before, occurrences(wed, wed.plusDays(1)).size)
        // Fixing it lets it through.
        val fixed = backwards.copy(endTime = t("16:00"))
        assertFalse(validateForm(fixed).any)
        create(fixed)
        assertNotNull(occurrenceOn("Backwards", wed))
    }

    @Test fun aTitleIsRequired() {
        assertEquals("editor_error_title", validateForm(blank()).title)
    }

    @Test fun anAllDayEventIsADateWithAnExclusiveEnd() = runBlocking {
        val made = create(blank().copy(title = "Conference", allDay = true, endDay = wed))
        assertEquals(wed.toString(), made.start)
        assertEquals(wed.plusDays(1).toString(), made.end)
        assertTrue(made.allDay)
        assertTrue(occurrenceOn("Conference", wed)!!.allDay)
    }

    @Test fun theSameEventIsVisibleToAnAgentThroughTheApi() = runBlocking {
        server.createEvent("""{"title":"From an agent","start":"${wed}T09:00:00"}""")
        assertTrue(occurrences(wed, wed.plusDays(1)).any { it.title == "From an agent" })
    }

    // --- writing safely ----------------------------------------------------------------------------

    @Test fun aStaleVersionIsRefusedAndNothingIsOverwritten() = runBlocking {
        val made = create(blank().copy(title = "Original"))
        val (master, occ) = open(occurrenceOn("Original", wed)!!)
        server.json("PATCH", "/api/events/${made.id}", """{"title":"Changed elsewhere"}""")
        val e = assertThrows(ApiException::class.java) {
            runBlocking { send(planUpdate(master, occ, formFromEvent(master, occ).copy(title = "Mine"), Scope.All)) }
        }
        assertEquals(412, e.status)
        assertEquals("version_conflict", e.code)
        assertEquals("Changed elsewhere", api.event(made.id).title)
    }

    @Test fun aRetriedCreateWithTheSameKeyCreatesOnce() = runBlocking {
        val plan = planCreate(blank().copy(title = "Dentist"))
        val first = nextAttempt(null, plan.requests[0]) { "key-A" }
        val a = api.write(plan.requests[0].copy(idempotencyKey = first.key))
        // The connection dropped before the answer arrived; the person taps Save again with the same form.
        val again = nextAttempt(first, plan.requests[0]) { "key-B" }
        assertEquals("key-A", again.key)
        val b = api.write(plan.requests[0].copy(idempotencyKey = again.key))
        assertEquals(a.event.id, b.event.id)
        assertEquals(1, occurrences(wed, wed.plusDays(1)).count { it.title == "Dentist" })
    }

    @Test fun aChangedCreateWithAReusedKeyIsRefused() = runBlocking {
        api.write(planCreate(blank().copy(title = "Dentist")).requests[0].copy(idempotencyKey = "same"))
        val e = assertThrows(ApiException::class.java) {
            runBlocking { api.write(planCreate(blank().copy(title = "Dentist (changed)")).requests[0].copy(idempotencyKey = "same")) }
        }
        assertEquals("idempotency_conflict", e.code)
    }

    // --- recurring events ----------------------------------------------------------------------------

    private fun weeklyWedFri() = Recurrence.Rule(Freq.WEEKLY, 1, listOf(3, 5), MonthlyMode.DayOfMonth, End.Never)

    private suspend fun gym(): Event = create(blank(wedIn(0), "16:00").copy(title = "Gym", endTime = t("17:00"), recurrence = weeklyWedFri()))

    @Test fun createAWeeklyRepeatOnWednesdayAndFriday() = runBlocking {
        val g = gym()
        assertTrue(g.rrule, Regex("FREQ=WEEKLY").containsMatchIn(g.rrule))
        assertTrue(g.rrule, g.rrule.contains("BYDAY=WE,FR"))
        assertNotNull(occurrenceOn("Gym", wedIn(0)))
        assertNotNull(occurrenceOn("Gym", wedIn(0).plusDays(2)))
    }

    @Test fun editingOneOccurrenceChangesOnlyThatOne() = runBlocking {
        gym()
        val (master, occ) = open(occurrenceOn("Gym", wedIn(1))!!)
        val form = formFromEvent(master, occ).copy(title = "Gym (special)", startTime = t("18:00"), endTime = t("19:00"))
        send(planUpdate(master, occ, form, Scope.This))
        val all = series("Gym")
        assertEquals(listOf(Triple("Gym (special)", "${wedIn(1)}T18:00:00", true)), all.filter { it.third })
        assertTrue(all.filter { !it.third }.all { it.first == "Gym" && it.second.endsWith("T16:00:00") })
        assertTrue(all.any { it.second == "${wedIn(1).plusDays(2)}T16:00:00" })
        assertTrue(all.any { it.second == "${wedIn(2)}T16:00:00" })
        assertFalse(all.any { it.second == "${wedIn(1)}T16:00:00" })
    }

    @Test fun thisAndFollowingSplitsTheSeriesAtThatOccurrence() = runBlocking {
        val g = gym()
        val (m1, o1) = open(occurrenceOn("Gym", wedIn(1))!!)
        send(planUpdate(m1, o1, formFromEvent(m1, o1).copy(title = "Gym (special)", startTime = t("18:00"), endTime = t("19:00")), Scope.This))
        val (master, occ) = open(occurrenceOn("Gym", wedIn(2))!!)
        val results = send(planUpdate(master, occ, formFromEvent(master, occ).copy(location = "Park"), Scope.Following))
        val old = api.event(g.id)
        val split = results.single().created!!
        assertEquals("", old.location)
        assertTrue(old.rrule, old.rrule.contains("UNTIL="))
        assertEquals("Park", split.location)
        assertEquals("${wedIn(2)}T16:00:00", split.start)
        // Before the split nothing changed; the earlier exception survives.
        assertEquals(1, series("Gym (special)").size)
        assertTrue(occurrences(wedIn(0), wedIn(2)).any { it.title == "Gym" && it.location == "" })
        assertEquals("Park", occurrenceOn("Gym", wedIn(2))!!.location)
    }

    @Test fun allEventsChangesTheWholeSeries() = runBlocking {
        gym()
        val (m, o) = open(occurrenceOn("Gym", wedIn(2))!!)
        send(planUpdate(m, o, formFromEvent(m, o).copy(location = "Park"), Scope.Following))
        val (master, occ) = open(occurrenceOn("Gym", wedIn(3))!!)
        send(planUpdate(master, occ, formFromEvent(master, occ).copy(title = "Training"), Scope.All))
        // "All" is the series the occurrence belongs to (the split-off one).
        val later = series("Training")
        assertTrue(later.size > 3)
        assertTrue(later.all { it.second >= "${wedIn(2)}" })
        assertEquals("${wedIn(2)}T16:00:00", later.minOf { it.second })
        assertTrue(series("Gym").all { it.second < "${wedIn(2)}" })
    }

    private suspend fun standup(): Event =
        create(blank(wedIn(0), "09:00").copy(title = "Standup", endTime = t("09:15"), recurrence = Recurrence.Rule(Freq.DAILY, 1, emptyList(), MonthlyMode.DayOfMonth, End.Never)))

    @Test fun deleteThisEventSkipsOneOccurrence() = runBlocking {
        val s = standup()
        val (m, o) = open(occurrenceOn("Standup", wedIn(1))!!)
        send(planDelete(m, o, Scope.This))
        assertNull(occurrenceOn("Standup", wedIn(1)))
        assertNotNull(occurrenceOn("Standup", wedIn(1).plusDays(1)))
        assertEquals(listOf("${wedIn(1)}T09:00:00"), api.event(s.id).exdates)
    }

    @Test fun deleteThisAndFollowingEndsTheSeriesThere() = runBlocking {
        standup()
        val (m, o) = open(occurrenceOn("Standup", wedIn(2))!!)
        send(planDelete(m, o, Scope.Following))
        assertNull(occurrenceOn("Standup", wedIn(2)))
        assertNull(occurrenceOn("Standup", wedIn(2).plusDays(3)))
        val rest = series("Standup")
        assertTrue(rest.isNotEmpty())
        assertTrue(rest.all { it.second < "${wedIn(2)}" })
    }

    @Test fun deleteAllEventsRemovesTheSeriesAndUndoBringsItBack() = runBlocking {
        val s = standup()
        val (m, o) = open(occurrenceOn("Standup", wedIn(0).plusDays(1))!!)
        send(planDelete(m, o, Scope.All))
        assertTrue(series("Standup").isEmpty())
        api.restoreEvent(s.id)
        assertNotNull(occurrenceOn("Standup", wedIn(0).plusDays(1)))
        assertTrue(series("Standup").isNotEmpty())
    }

    @Test fun movingARecurringSeriesToAnotherDayTellsWhichChangedOccurrencesWereReset() = runBlocking {
        gym()
        val (m1, o1) = open(occurrenceOn("Gym", wedIn(1))!!)
        send(planUpdate(m1, o1, formFromEvent(m1, o1).copy(title = "Gym (special)"), Scope.This))
        val (master, occ) = open(occurrenceOn("Gym", wedIn(2))!!)
        val form = formFromEvent(master, occ).copy(startDay = wedIn(2).plusDays(1), endDay = wedIn(2).plusDays(1))
        val results = send(planUpdate(master, occ, form, Scope.All))
        assertEquals(1, droppedOverrides(results))
        assertNotNull(occurrenceOn("Gym", wedIn(2).plusDays(1)))
    }

    @Test fun aRuleTheEditorCannotExpressStaysExactlyAsStoredEvenWhenTheTitleIsEdited() = runBlocking {
        var last = LocalDate.of(wed.year, wed.month, 1).plusMonths(1).minusDays(1)
        while (last.dayOfWeek == DayOfWeek.SATURDAY || last.dayOfWeek == DayOfWeek.SUNDAY) last = last.minusDays(1)
        if (last.isBefore(today)) last = last.plusMonths(1).withDayOfMonth(1).plusMonths(1).minusDays(1)
        val rule = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"
        val made = server.createEvent("""{"title":"Month close","start":"${last}T09:00:00","end":"${last}T10:00:00","tz":"UTC","rrule":"$rule"}""")
        val id = made["id"]!!.jsonPrimitive.content
        val before = api.event(id)
        assertTrue(before.rrule, before.rrule.contains("BYSETPOS=-1"))
        val occ = occurrenceOn("Month close", last)!!
        val master = api.event(id)
        val form = formFromEvent(master, occ)
        assertTrue(form.recurrence is Recurrence.Raw)
        send(planUpdate(master, occ, form.copy(title = "Month close (finance)"), Scope.All))
        val after = api.event(id)
        assertEquals("Month close (finance)", after.title)
        assertEquals(before.rrule, after.rrule)
    }

    @Test fun anEventWithRemindersKeepsThemThroughAnEditOfTheTitle() = runBlocking {
        val made = create(blank().copy(title = "Dentist", reminders = listOf(1440, 30)))
        val (m, o) = open(occurrenceOn("Dentist", wed)!!)
        send(planUpdate(m, o, formFromEvent(m, o).copy(title = "Dentist 2"), Scope.All))
        assertEquals(listOf(1440, 30), api.event(made.id).reminders.map { it.minutesBefore })
    }
}

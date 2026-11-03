package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Reminder
import dev.qarasky.korecalendar.data.WriteRequest
import dev.qarasky.korecalendar.data.WriteResult
import dev.qarasky.korecalendar.edit.End
import dev.qarasky.korecalendar.edit.Freq
import dev.qarasky.korecalendar.edit.FormValues
import dev.qarasky.korecalendar.edit.MonthlyMode
import dev.qarasky.korecalendar.edit.Plan
import dev.qarasky.korecalendar.edit.Recurrence
import dev.qarasky.korecalendar.edit.Scope
import dev.qarasky.korecalendar.edit.allowedDeleteScopes
import dev.qarasky.korecalendar.edit.droppedOverrides
import dev.qarasky.korecalendar.edit.formFromEvent
import dev.qarasky.korecalendar.edit.newFormValues
import dev.qarasky.korecalendar.edit.nextAttempt
import dev.qarasky.korecalendar.edit.planCreate
import dev.qarasky.korecalendar.edit.planDelete
import dev.qarasky.korecalendar.edit.planUpdate
import dev.qarasky.korecalendar.edit.validateForm
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported from web/lib/__tests__/editPlan.test.ts: the phone asks the server for exactly what the web editor does. */
class EditPlanTest {
    private fun event(
        rrule: String = "FREQ=WEEKLY;BYDAY=WE,FR", start: String = "2026-11-04T16:00:00", end: String = "2026-11-04T17:00:00",
        allDay: Boolean = false, tz: String = "Europe/Berlin",
    ) = Event(
        id = "g1", calendarId = "c1", title = "Gym", start = start, end = end, tz = tz, allDay = allDay, rrule = rrule,
        reminders = listOf(Reminder(30)), version = 3,
    )

    private fun occurrence(master: Event, key: String, title: String = master.title, start: String = key, end: String = key.replace("T16:00:00", "T17:00:00")) = Occurrence(
        eventId = master.id, calendarId = master.calendarId, key = key, title = title, notes = master.notes, location = master.location,
        start = start, end = end, tz = master.tz, allDay = master.allDay, isRecurring = master.rrule != "", isOverride = false,
        startUtc = Instant.EPOCH, endUtc = Instant.EPOCH, reminders = master.reminders,
    )

    private val gym = event()
    private val nov11 = occurrence(gym, "2026-11-11T16:00:00")

    private fun form(master: Event, occ: Occurrence?, edit: (FormValues) -> FormValues = { it }) = edit(formFromEvent(master, occ))
    private fun t(s: String) = LocalTime.parse(s)
    private fun d(s: String) = LocalDate.parse(s)
    private fun only(plan: Plan): WriteRequest {
        assertEquals(1, plan.requests.size)
        return plan.requests[0]
    }

    private fun obj(vararg p: Pair<String, Any>): JsonObject = buildJsonObject {
        for ((k, v) in p) when (v) {
            is String -> put(k, v)
            is Boolean -> put(k, v)
            is List<*> -> put(k, JsonArray(v.map { m -> buildJsonObject { put("minutes_before", m as Int) } }))
            else -> error("unsupported")
        }
    }

    private fun weeklyRule(days: List<Int>, interval: Int = 1) = Recurrence.Rule(Freq.WEEKLY, interval, days, MonthlyMode.DayOfMonth, End.Never)

    // --- formFromEvent

    @Test fun theFormShowsTheOccurrencesOwnTimeTitleAndReminders() {
        val f = formFromEvent(gym, occurrence(gym, "2026-11-11T16:00:00", title = "Gym (late)", start = "2026-11-11T18:00:00", end = "2026-11-11T19:00:00"))
        assertEquals("Gym (late)", f.title)
        assertEquals(d("2026-11-11"), f.startDay); assertEquals(t("18:00"), f.startTime)
        assertEquals(d("2026-11-11"), f.endDay); assertEquals(t("19:00"), f.endTime)
        assertEquals("Europe/Berlin", f.tz)
        assertEquals(listOf(30), f.reminders)
        assertEquals(weeklyRule(listOf(3, 5)), f.recurrence)
    }

    @Test fun anAllDayEventShowsItsLastDayInclusively() {
        val trip = event(allDay = true, start = "2026-12-24", end = "2026-12-27", rrule = "")
        val f = formFromEvent(trip, null)
        assertTrue(f.allDay)
        assertEquals(d("2026-12-24"), f.startDay)
        assertEquals(d("2026-12-26"), f.endDay)
    }

    // --- planCreate

    @Test fun createsATimedEvent() {
        val f = form(gym, null) { it.copy(recurrence = Recurrence.None, title = "Lunch", startDay = d("2026-11-05"), startTime = t("12:00"), endDay = d("2026-11-05"), endTime = t("13:00")) }
        val plan = planCreate(f)
        assertEquals(
            listOf(
                WriteRequest(
                    "POST", "/api/events",
                    obj("calendar_id" to "c1", "title" to "Lunch", "notes" to "", "location" to "", "start" to "2026-11-05T12:00:00", "end" to "2026-11-05T13:00:00", "tz" to "Europe/Berlin", "all_day" to false, "reminders" to listOf(30)),
                    null, null,
                ),
            ),
            plan.requests,
        )
        assertEquals(listOf(Scope.All), plan.allowedScopes)
    }

    @Test fun createsAnAllDayEventWithAnExclusiveEnd() {
        val f = form(gym, null) { it.copy(recurrence = Recurrence.None, title = "Holiday", allDay = true, startDay = d("2026-12-24"), endDay = d("2026-12-24"), reminders = listOf(1440)) }
        val body = planCreate(f).requests[0].body!!
        assertEquals(JsonPrimitive(true), body["all_day"])
        assertEquals(JsonPrimitive("2026-12-24"), body["start"])
        assertEquals(JsonPrimitive("2026-12-25"), body["end"])
    }

    @Test fun sendsTheRuleOnlyWhenTheEventRepeats() {
        assertEquals(JsonPrimitive("FREQ=WEEKLY;BYDAY=WE,FR"), planCreate(form(gym, null)).requests[0].body!!["rrule"])
        assertFalse(planCreate(form(gym, null) { it.copy(recurrence = Recurrence.None) }).requests[0].body!!.containsKey("rrule"))
    }

    // --- planUpdate: all

    @Test fun sendsOnlyWhatChangedGuardedByTheVersion() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(title = "Gym 2") }, Scope.All))
        assertEquals(WriteRequest("PATCH", "/api/events/g1", obj("title" to "Gym 2"), 3, null), req)
    }

    @Test fun doesNothingWhenNothingChanged() = assertEquals(emptyList<WriteRequest>(), planUpdate(gym, nov11, form(gym, nov11), Scope.All).requests)

    @Test fun movesTheSeriesStartByWhatTheOccurrenceMovedBy() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(startTime = t("18:00"), endTime = t("19:00")) }, Scope.All))
        assertEquals(obj("start" to "2026-11-04T18:00:00", "end" to "2026-11-04T19:00:00"), req.body)
    }

    @Test fun changesTheDurationOfTheWholeSeries() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(endTime = t("17:30")) }, Scope.All))
        assertEquals(obj("start" to "2026-11-04T16:00:00", "end" to "2026-11-04T17:30:00"), req.body)
    }

    @Test fun movesAWeeklySeriesByADayAndRotatesItsWeekdays() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(startDay = d("2026-11-12"), endDay = d("2026-11-12")) }, Scope.All))
        assertEquals(obj("start" to "2026-11-05T16:00:00", "end" to "2026-11-05T17:00:00", "rrule" to "FREQ=WEEKLY;BYDAY=TH,SA"), req.body)
    }

    @Test fun changesTheZoneTheCalendarAndTheReminders() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(tz = "UTC", calendarId = "c2", reminders = listOf(60, 10)) }, Scope.All))
        assertEquals(obj("tz" to "UTC", "calendar_id" to "c2", "reminders" to listOf(60, 10)), req.body)
    }

    @Test fun rewritesTheRuleOnlyWhenThePersonChangedIt() {
        val daily = Recurrence.Rule(Freq.DAILY, 1, emptyList(), MonthlyMode.DayOfMonth, End.Never)
        assertEquals(obj("rrule" to "FREQ=DAILY"), only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(recurrence = daily) }, Scope.All)).body)
        assertEquals(obj("rrule" to ""), only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(recurrence = Recurrence.None) }, Scope.All)).body)
    }

    @Test fun switchingASingleEventToAllDayConvertsItsTimesToDates() {
        val once = event(rrule = "", start = "2026-12-24T09:00:00", end = "2026-12-24T10:00:00")
        val req = only(planUpdate(once, null, form(once, null) { it.copy(allDay = true) }, Scope.All))
        assertEquals(obj("all_day" to true, "start" to "2026-12-24", "end" to "2026-12-25"), req.body)
    }

    @Test fun switchingAnAllDayEventToTimedGivesItTimes() {
        val trip = event(rrule = "", allDay = true, start = "2026-12-24", end = "2026-12-25")
        val req = only(planUpdate(trip, null, form(trip, null) { it.copy(allDay = false, startTime = t("09:00"), endTime = t("10:00")) }, Scope.All))
        assertEquals(obj("all_day" to false, "start" to "2026-12-24T09:00:00", "end" to "2026-12-24T10:00:00"), req.body)
    }

    // --- planUpdate: this

    private val thisQuery = "?scope=this&occurrence=2026-11-11T16%3A00%3A00"

    @Test fun movesOneOccurrenceAndLeavesTheDurationToTheApi() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(startTime = t("18:00"), endTime = t("19:00")) }, Scope.This))
        assertEquals(WriteRequest("PATCH", "/api/events/g1$thisQuery", obj("start" to "2026-11-11T18:00:00"), 3, null), req)
    }

    @Test fun sendsTheEndWhenTheDurationChanged() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(startTime = t("18:00"), endTime = t("19:30")) }, Scope.This))
        assertEquals(obj("start" to "2026-11-11T18:00:00", "end" to "2026-11-11T19:30:00"), req.body)
    }

    @Test fun changesTheTextOfOneOccurrenceAndNeverTheRuleOrZone() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(title = "Special", notes = "x", location = "Park") }, Scope.This))
        assertEquals(obj("title" to "Special", "notes" to "x", "location" to "Park"), req.body)
    }

    // --- planUpdate: following

    private val followingQuery = "?scope=following&occurrence=2026-11-11T16%3A00%3A00"

    @Test fun editsFromThisOccurrenceOn() {
        val req = only(planUpdate(gym, nov11, form(gym, nov11) { it.copy(location = "Park") }, Scope.Following))
        assertEquals(WriteRequest("PATCH", "/api/events/g1$followingQuery", obj("location" to "Park"), 3, null), req)
    }

    @Test fun startsTheNewSeriesWhereTheOccurrenceNowIsWithItsWeekdaysRotated() {
        val f = form(gym, nov11) { it.copy(startDay = d("2026-11-12"), endDay = d("2026-11-12"), startTime = t("17:00"), endTime = t("18:00")) }
        val req = only(planUpdate(gym, nov11, f, Scope.Following))
        assertEquals(obj("start" to "2026-11-12T17:00:00", "end" to "2026-11-12T18:00:00", "rrule" to "FREQ=WEEKLY;BYDAY=TH,SA"), req.body)
    }

    // --- allowed scopes

    @Test fun aSingleEventCanOnlyBeChangedAsAWhole() {
        val once = event(rrule = "")
        assertEquals(listOf(Scope.All), planUpdate(once, null, form(once, null) { it.copy(title = "x") }, Scope.All).allowedScopes)
        assertEquals(listOf(Scope.All), allowedDeleteScopes(once))
    }

    @Test fun aSeriesOffersAllThreeForAPlainEdit() {
        assertEquals(listOf(Scope.This, Scope.Following, Scope.All), planUpdate(gym, nov11, form(gym, nov11) { it.copy(title = "x") }, Scope.All).allowedScopes)
        assertEquals(listOf(Scope.This, Scope.Following, Scope.All), allowedDeleteScopes(gym))
    }

    @Test fun changingTheZoneTheRuleOrTheCalendarTakesAwayThisEvent() {
        val edits: List<(FormValues) -> FormValues> = listOf({ it.copy(tz = "UTC") }, { it.copy(calendarId = "c2") }, { it.copy(recurrence = Recurrence.None) })
        for (edit in edits) assertEquals(listOf(Scope.Following, Scope.All), planUpdate(gym, nov11, form(gym, nov11, edit), Scope.All).allowedScopes)
    }

    @Test fun aRuleThatCannotFollowAMovedDayOnlyAllowsThisEventForThatMove() {
        val monthly = event(rrule = "FREQ=MONTHLY;BYDAY=2WE")
        val occ = occurrence(monthly, "2026-11-11T16:00:00")
        val plan = planUpdate(monthly, occ, form(monthly, occ) { it.copy(startDay = d("2026-11-12"), endDay = d("2026-11-12")) }, Scope.This)
        assertEquals(listOf(Scope.This), plan.allowedScopes)
        assertEquals(listOf("editplan_warn_cannot_move_day"), plan.warnings)
        val later = planUpdate(monthly, occ, form(monthly, occ) { it.copy(startTime = t("18:00"), endTime = t("19:00")) }, Scope.All)
        assertEquals(listOf(Scope.This, Scope.Following, Scope.All), later.allowedScopes)
    }

    @Test fun aCountedRuleCannotBeSplitAtAMovedDay() {
        val counted = event(rrule = "FREQ=WEEKLY;BYDAY=WE,FR;COUNT=10")
        val occ = occurrence(counted, "2026-11-11T16:00:00")
        val plan = planUpdate(counted, occ, form(counted, occ) { it.copy(startDay = d("2026-11-12"), endDay = d("2026-11-12")) }, Scope.All)
        assertEquals(listOf(Scope.This, Scope.All), plan.allowedScopes)
    }

    // --- a rule the editor cannot express

    private val odd = event(rrule = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", start = "2026-10-30T17:00:00", end = "2026-10-30T18:00:00")
    private val oddOcc = occurrence(odd, "2026-11-30T17:00:00", end = "2026-11-30T18:00:00")

    @Test fun aRawRuleShowsAsRaw() = assertEquals(Recurrence.Raw(odd.rrule), formFromEvent(odd, oddOcc).recurrence)

    @Test fun aRawRuleIsLeftAloneWhenOtherFieldsChange() {
        for (scope in listOf(Scope.All, Scope.Following)) {
            val req = only(planUpdate(odd, oddOcc, form(odd, oddOcc) { it.copy(title = "Pay rent") }, scope))
            assertEquals(scope.name, obj("title" to "Pay rent"), req.body)
        }
    }

    // --- planDelete

    @Test fun buildsEachDeleteScopesRequest() {
        assertEquals(listOf(WriteRequest("DELETE", "/api/events/g1", null, 3, null)), planDelete(gym, nov11, Scope.All).requests)
        assertEquals(listOf(WriteRequest("DELETE", "/api/events/g1$thisQuery", null, 3, null)), planDelete(gym, nov11, Scope.This).requests)
        assertEquals("/api/events/g1$followingQuery", planDelete(gym, nov11, Scope.Following).requests[0].path)
    }

    @Test fun deletingASingleEventIgnoresAScopeTheDialogNeverOffered() {
        assertEquals("/api/events/g1", planDelete(event(rrule = ""), null, Scope.This).requests[0].path)
    }

    // --- validateForm

    @Test fun needsATitleAndAnEndThatIsNotBeforeTheStart() {
        assertEquals(null to null, validateForm(form(gym, nov11)).let { it.title to it.end })
        assertEquals("editor_error_title", validateForm(form(gym, nov11) { it.copy(title = "  ") }).title)
        assertEquals("editor_error_end_before_start", validateForm(form(gym, nov11) { it.copy(endTime = t("15:00")) }).end)
        assertEquals("editor_error_end_before_start", validateForm(form(gym, nov11) { it.copy(endDay = d("2026-11-10")) }).end)
    }

    @Test fun allowsAnAllDayEventOnASingleDay() {
        assertEquals(null, validateForm(form(gym, nov11) { it.copy(allDay = true, startDay = d("2026-11-11"), endDay = d("2026-11-11")) }).end)
        assertEquals("editor_error_end_before_start", validateForm(form(gym, nov11) { it.copy(allDay = true, startDay = d("2026-11-11"), endDay = d("2026-11-10")) }).end)
    }

    // --- scope fallbacks

    @Test fun fallsBackToAScopeThatIsAllowedNeverToANarrowerChange() {
        val req = planUpdate(gym, nov11, form(gym, nov11) { it.copy(tz = "UTC") }, Scope.This).requests[0]
        assertEquals("/api/events/g1", req.path)
        assertEquals(obj("tz" to "UTC"), req.body)
    }

    @Test fun neverPutsTheZoneTheRuleOrTheCalendarInAOneOccurrenceChange() {
        val req = planUpdate(gym, nov11, form(gym, nov11) { it.copy(title = "Special", startTime = t("18:00"), endTime = t("19:00")) }, Scope.This).requests[0]
        for (forbidden in listOf("tz", "rrule", "calendar_id")) assertFalse(forbidden, req.body!!.containsKey(forbidden))
    }

    @Test fun rewritesARulesUntilWhenTheZoneChangesUnderIt() {
        val until = event(rrule = "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261231T225959Z")
        val occ = occurrence(until, "2026-11-11T16:00:00")
        val req = only(planUpdate(until, occ, form(until, occ) { it.copy(tz = "UTC") }, Scope.All))
        assertEquals(obj("tz" to "UTC", "rrule" to "FREQ=WEEKLY;BYDAY=WE,FR;UNTIL=20261231T235959Z"), req.body)
    }

    @Test fun aNewSeriesMadeByFollowingWithAChangedRuleGetsARuleBuiltFromTheOccurrencesDay() {
        val f = form(gym, nov11) { it.copy(recurrence = weeklyRule(listOf(3), interval = 2)) }
        val req = only(planUpdate(gym, nov11, f, Scope.Following))
        assertEquals("/api/events/g1$followingQuery", req.path)
        assertEquals(obj("rrule" to "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE"), req.body)
    }

    // --- newFormValues

    @Test fun startsWhereThePersonClickedForTheLengthTheyChose() {
        val f = newFormValues(d("2026-11-05"), t("13:30"), 90, false, "Europe/Berlin", "c1")
        assertEquals("", f.title)
        assertEquals(d("2026-11-05"), f.startDay); assertEquals(t("13:30"), f.startTime)
        assertEquals(d("2026-11-05"), f.endDay); assertEquals(t("15:00"), f.endTime)
        assertEquals(Recurrence.None, f.recurrence)
        assertEquals(emptyList<Int>(), f.reminders)
    }

    @Test fun defaultsToAnHourAndRollsOverMidnight() {
        assertEquals(t("10:00"), newFormValues(d("2026-11-05"), t("09:00"), 60, false, "UTC", "c1").endTime)
        val late = newFormValues(d("2026-11-05"), t("23:30"), 60, false, "UTC", "c1")
        assertEquals(d("2026-11-06"), late.endDay); assertEquals(t("00:30"), late.endTime)
    }

    @Test fun makesAnAllDayEventOnOneDay() {
        val f = newFormValues(d("2026-11-05"), t("00:00"), 60, true, "UTC", "c1")
        assertTrue(f.allDay); assertEquals(d("2026-11-05"), f.startDay); assertEquals(d("2026-11-05"), f.endDay)
    }

    // --- idempotency

    private fun createReq(title: String) = planCreate(newFormValues(d("2026-11-04"), t("09:00"), 60, false, "UTC", "c1").copy(title = title)).requests[0]

    @Test fun theFirstAttemptGetsAFreshKey() = assertEquals("k1", nextAttempt(null, createReq("Dentist")) { "k1" }.key)

    @Test fun theSameRequestKeepsItsKeySoARetryIsReplayedNotRepeated() {
        val first = nextAttempt(null, createReq("Dentist")) { "k1" }
        assertEquals("k1", nextAttempt(first, createReq("Dentist")) { "k2" }.key)
    }

    @Test fun aChangedRequestTakesANewKey() {
        val first = nextAttempt(null, createReq("Dentist")) { "k1" }
        assertEquals("k2", nextAttempt(first, createReq("Dentist (changed)")) { "k2" }.key)
        assertNotEquals(first.fingerprint, nextAttempt(first, createReq("Dentist (changed)")) { "k2" }.fingerprint)
    }

    // --- dropped overrides

    private fun result(vararg keys: String) = WriteResult(gym, null, keys.toList())

    @Test fun countsTheKeysTheApiListsAsDropped() {
        assertEquals(2, droppedOverrides(listOf(result("2026-11-09T09:00:00", "2026-11-16T09:00:00"))))
        assertEquals(3, droppedOverrides(listOf(result(), result("x"), result("y", "z"))))
        assertEquals(0, droppedOverrides(emptyList()))
    }
}

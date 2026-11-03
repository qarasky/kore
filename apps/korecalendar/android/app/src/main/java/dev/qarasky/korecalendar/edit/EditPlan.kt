package dev.qarasky.korecalendar.edit

import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.WriteRequest
import dev.qarasky.korecalendar.data.WriteResult
import java.net.URLEncoder
import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Turns what a person did (edited the form, pressed Delete) into the API requests that do exactly
 * that, and says which scopes are safe. Ported from `web/lib/editPlan.ts`; pure and exhaustively
 * tested, because this is where "change this event" must not silently change the whole series.
 *
 * Times are wall-clock in the event's own zone, like the API's. An occurrence is identified by its
 * key (its original start).
 */
enum class Scope(val wire: String) { This("this"), Following("following"), All("all") }

/** The editor's values. For all-day events [endDay] is the last day, inclusive (the API's end is exclusive). */
data class FormValues(
    val title: String,
    val notes: String,
    val location: String,
    val calendarId: String,
    val allDay: Boolean,
    val startDay: LocalDate,
    val startTime: LocalTime,
    val endDay: LocalDate,
    val endTime: LocalTime,
    val tz: String,
    val recurrence: Recurrence,
    /** Minutes before the start. */
    val reminders: List<Int>,
)

/** [requests] is empty when nothing changed. [warnings] are `strings.xml` names. */
data class Plan(val requests: List<WriteRequest>, val allowedScopes: List<Scope>, val warnings: List<String>)

/** Problems with a form, as `strings.xml` names (null = fine). */
data class FormErrors(val title: String?, val end: String?) {
    val any: Boolean get() = title != null || end != null
}

private val ALL_SCOPES = listOf(Scope.This, Scope.Following, Scope.All)
private val DEFAULT_START = LocalTime.of(9, 0)
private val DEFAULT_END = LocalTime.of(10, 0)

internal fun zoneOf(tz: String): ZoneId = try {
    ZoneId.of(tz)
} catch (_: DateTimeException) {
    ZoneId.of("UTC")
}

private fun isRecurring(master: Event, occ: Occurrence?) = occ?.isRecurring ?: (master.rrule != "")

/** The form for an event, or for one occurrence of a series. */
fun formFromEvent(master: Event, occ: Occurrence?): FormValues {
    val src = if (occ != null) Triple(occ.title, occ.notes to occ.location, occ.start to occ.end) else Triple(master.title, master.notes to master.location, master.start to master.end)
    val allDay = occ?.allDay ?: master.allDay
    val reminders = (occ?.reminders ?: master.reminders).map { it.minutesBefore }
    val recurrence = parseRule(master.rrule, parseWall(master.start).toLocalDate(), RuleContext(zoneOf(master.tz), master.allDay))
    val (title, text, times) = src
    val (startS, endS) = times
    if (allDay) {
        val start = parseWall(startS).toLocalDate()
        val last = parseWall(endS).toLocalDate().minusDays(1)
        return FormValues(title, text.first, text.second, master.calendarId, true, start, DEFAULT_START, if (last.isBefore(start)) start else last, DEFAULT_END, master.tz, recurrence, reminders)
    }
    val s = parseWall(startS)
    val e = parseWall(endS)
    return FormValues(title, text.first, text.second, master.calendarId, false, s.toLocalDate(), s.toLocalTime(), e.toLocalDate(), e.toLocalTime(), master.tz, recurrence, reminders)
}

/** The form for a new event that starts at [time] on [day] and lasts [durationMinutes]. */
fun newFormValues(day: LocalDate, time: LocalTime, durationMinutes: Long, allDay: Boolean, tz: String, calendarId: String): FormValues {
    val end = day.atTime(time).plusMinutes(durationMinutes)
    return FormValues(
        title = "", notes = "", location = "", calendarId = calendarId, allDay = allDay,
        startDay = day, startTime = if (allDay) DEFAULT_START else time,
        endDay = if (allDay) day else end.toLocalDate(), endTime = if (allDay) DEFAULT_END else end.toLocalTime(),
        tz = tz, recurrence = Recurrence.None, reminders = emptyList(),
    )
}

fun validateForm(f: FormValues): FormErrors {
    val title = if (f.title.isBlank()) "editor_error_title" else null
    val end = if (f.allDay) {
        if (f.endDay.isBefore(f.startDay)) "editor_error_end_before_start" else null
    } else {
        if (f.endDay.atTime(f.endTime).isBefore(f.startDay.atTime(f.startTime))) "editor_error_end_before_start" else null
    }
    return FormErrors(title, end)
}

private data class ApiTimes(val start: String, val end: String)

/** The start and the (exclusive, for all-day) end the API wants. */
private fun apiTimes(f: FormValues) =
    if (f.allDay) ApiTimes(f.startDay.toString(), f.endDay.plusDays(1).toString())
    else ApiTimes(wallString(f.startDay, f.startTime), wallString(f.endDay, f.endTime))

private fun remindersJson(minutes: List<Int>) = JsonArray(minutes.map { m -> buildJsonObject { put("minutes_before", m) } })

private fun canonicalSet(a: List<Int>) = a.sorted()

fun planCreate(f: FormValues): Plan {
    val t = apiTimes(f)
    val rrule = buildRule(f.recurrence, f.startDay, RuleContext(zoneOf(f.tz), f.allDay))
    val body = buildJsonObject {
        put("calendar_id", f.calendarId)
        put("title", f.title.trim())
        put("notes", f.notes)
        put("location", f.location)
        put("start", t.start)
        put("end", t.end)
        put("tz", f.tz)
        put("all_day", f.allDay)
        put("reminders", remindersJson(f.reminders))
        if (rrule != "") put("rrule", rrule)
    }
    return Plan(listOf(WriteRequest("POST", "/api/events", body, null, null)), listOf(Scope.All), emptyList())
}

/** The last create the person tried and the key it was sent with. */
data class Attempt(val fingerprint: String, val key: String)

/**
 * The key for sending [req]: the same one as the previous attempt when it is the same request (a
 * retry after a timeout, whose first try may have landed), a new one when the person changed
 * something (the API refuses a key reused with a different body).
 */
fun nextAttempt(prev: Attempt?, req: WriteRequest, newKey: () -> String): Attempt {
    val fingerprint = "${req.method} ${req.path} ${req.body}"
    return if (prev != null && prev.fingerprint == fingerprint) prev else Attempt(fingerprint, newKey())
}

/** How many changed occurrences a series edit reset, from the responses' `dropped_overrides`. */
fun droppedOverrides(results: List<WriteResult>): Int = results.sumOf { it.dropped.size }

private fun occurrenceQuery(scope: Scope, key: String) =
    if (scope == Scope.All) "" else "?scope=${scope.wire}&occurrence=${URLEncoder.encode(key, "UTF-8")}"

/** Which scopes a delete may use. */
fun allowedDeleteScopes(master: Event, occ: Occurrence? = null): List<Scope> = if (isRecurring(master, occ)) ALL_SCOPES else listOf(Scope.All)

fun planDelete(master: Event, occurrence: Occurrence?, scope: Scope): Plan {
    val allowed = allowedDeleteScopes(master, occurrence)
    val effective = if (scope in allowed && occurrence != null) scope else Scope.All
    val path = "/api/events/${master.id}${occurrenceQuery(effective, occurrence?.key ?: "")}"
    return Plan(listOf(WriteRequest("DELETE", path, null, master.version, null)), allowed, emptyList())
}

private fun days(a: String, b: String) = ChronoUnit.DAYS.between(parseWall(a).toLocalDate(), parseWall(b).toLocalDate())

/**
 * The request for saving [form] over the event (or occurrence) it came from, at [scope], plus the
 * scopes that are allowed for these particular changes.
 */
fun planUpdate(master: Event, occurrence: Occurrence?, form: FormValues, scope: Scope): Plan {
    val orig = formFromEvent(master, occurrence)
    val recurring = isRecurring(master, occurrence)
    val masterCtx = RuleContext(zoneOf(master.tz), master.allDay)
    val masterStartDay = parseWall(master.start).toLocalDate()
    val key = occurrence?.key ?: master.start

    val changedTitle = form.title.trim() != orig.title
    val changedNotes = form.notes != orig.notes
    val changedLocation = form.location != orig.location
    val changedCalendar = form.calendarId != orig.calendarId
    val changedTz = form.tz != orig.tz
    val changedAllDay = form.allDay != orig.allDay
    val changedStart = form.startDay != orig.startDay || (!form.allDay && form.startTime != orig.startTime)
    val changedEnd = form.endDay != orig.endDay || (!form.allDay && form.endTime != orig.endTime)
    val changedReminders = canonicalSet(form.reminders) != canonicalSet(orig.reminders)
    val changedRecurrence = form.recurrence != orig.recurrence
    val dayDelta = ChronoUnit.DAYS.between(orig.startDay, form.startDay).toInt()
    val warnings = mutableListOf<String>()

    // --- which scopes are safe for these changes
    var allowed: List<Scope> = if (recurring) ALL_SCOPES else listOf(Scope.All)
    if (recurring) {
        if (changedTz || changedCalendar || changedRecurrence) allowed = allowed.filter { it != Scope.This }
        if (dayDelta != 0 && !changedRecurrence) {
            if (shiftRuleByDays(master.rrule, dayDelta, masterStartDay, masterCtx) == null) {
                allowed = allowed.filter { it == Scope.This }
                warnings += "editplan_warn_cannot_move_day"
            } else if (Regex("(^|;)COUNT=", RegexOption.IGNORE_CASE).containsMatchIn(master.rrule)) {
                allowed = allowed.filter { it != Scope.Following }
            }
        }
    }

    val anyChange = listOf(
        changedTitle, changedNotes, changedLocation, changedCalendar, changedTz, changedAllDay, changedStart, changedEnd, changedReminders, changedRecurrence,
    ).any { it }
    val effective = if (scope in allowed) scope else allowed.lastOrNull() ?: Scope.All
    if (!anyChange) return Plan(emptyList(), allowed, warnings)

    val times = apiTimes(form)
    val origTimes = apiTimes(orig)
    fun duration(t: ApiTimes, allDay: Boolean) =
        if (allDay) days(t.start, t.end) else diffMinutes(parseWall(t.start), parseWall(t.end))
    val durationChanged = changedAllDay || duration(times, form.allDay) != duration(origTimes, orig.allDay)

    val body = linkedMapOf<String, kotlinx.serialization.json.JsonElement>()
    fun put(k: String, v: String) { body[k] = kotlinx.serialization.json.JsonPrimitive(v) }
    fun put(k: String, v: Boolean) { body[k] = kotlinx.serialization.json.JsonPrimitive(v) }
    if (changedTitle) put("title", form.title.trim())
    if (changedNotes) put("notes", form.notes)
    if (changedLocation) put("location", form.location)
    if (changedReminders) body["reminders"] = remindersJson(form.reminders)
    if (changedAllDay) put("all_day", form.allDay)

    if (effective == Scope.This) {
        if (changedStart || changedAllDay) put("start", times.start)
        if (durationChanged || (changedEnd && !changedStart)) put("end", times.end)
    } else {
        // The whole series, or the new series that starts at this occurrence.
        if (changedTz) put("tz", form.tz)
        if (changedCalendar) put("calendar_id", form.calendarId)
        val timeTouched = changedStart || changedEnd || changedAllDay
        var newMasterStartDay: LocalDate = if (effective == Scope.Following) LocalDate.parse(times.start.take(10)) else masterStartDay
        if (timeTouched) {
            if (effective == Scope.Following) {
                put("start", times.start)
                put("end", times.end)
            } else {
                // The series start moves by what the occurrence moved by.
                val dur = duration(times, form.allDay)
                newMasterStartDay = masterStartDay.plusDays(dayDelta.toLong())
                if (form.allDay) {
                    put("start", newMasterStartDay.toString())
                    put("end", newMasterStartDay.plusDays(dur).toString())
                } else {
                    val minutesDelta = ChronoUnit.MINUTES.between(orig.startTime, form.startTime)
                    val start: LocalDateTime =
                        if (changedAllDay) newMasterStartDay.atTime(form.startTime)
                        else parseWall(master.start).plusMinutes(dayDelta * 1440L + minutesDelta)
                    newMasterStartDay = start.toLocalDate()
                    put("start", wallString(start))
                    put("end", wallString(start.plusMinutes(dur)))
                }
            }
        }
        // The rule: rewritten only if the person changed it (or it embeds the zone/format that just changed);
        // otherwise a moved day carries the weekdays along. A rule the editor cannot express is never touched.
        val formRule = form.recurrence
        val rewrites = changedRecurrence || ((changedTz || changedAllDay) && formRule is Recurrence.Rule && formRule.end is End.Until)
        val formCtx = RuleContext(zoneOf(form.tz), form.allDay)
        if (recurring && rewrites) {
            val from = if (effective == Scope.Following) LocalDate.parse(times.start.take(10)) else newMasterStartDay
            val rule = buildRule(formRule, from, formCtx)
            if (rule != master.rrule) put("rrule", rule)
        } else if (!recurring && changedRecurrence) {
            put("rrule", buildRule(formRule, newMasterStartDay, formCtx))
        } else if (recurring && dayDelta != 0) {
            val from = if (effective == Scope.Following) orig.startDay else masterStartDay
            val shifted = shiftRuleByDays(master.rrule, dayDelta, from, masterCtx)
            if (shifted != null && shifted != master.rrule) put("rrule", shifted)
        }
    }

    if (body.isEmpty()) return Plan(emptyList(), allowed, warnings)
    return Plan(
        listOf(WriteRequest("PATCH", "/api/events/${master.id}${occurrenceQuery(effective, key)}", JsonObject(body), master.version, null)),
        allowed,
        warnings,
    )
}

/** The form with its start moved; the end moves with it, so the duration (or an all-day event's length in days) stays. */
fun FormValues.withStart(day: LocalDate, time: LocalTime): FormValues {
    if (allDay) return copy(startDay = day, endDay = day.plusDays(ChronoUnit.DAYS.between(startDay, endDay)))
    val length = diffMinutes(startDay.atTime(startTime), endDay.atTime(endTime))
    val end = day.atTime(time).plusMinutes(length)
    return copy(startDay = day, startTime = time, endDay = end.toLocalDate(), endTime = end.toLocalTime())
}

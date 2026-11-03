package dev.qarasky.korecalendar.agenda

import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Occurrence
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

// What the agenda screen and the widget list. No Android imports: everything here is plain
// java.time, so it is tested on the JVM.
//
// Times: a timed occurrence is placed by its start_utc/end_utc converted to the ACCOUNT's time
// zone (not the event's own zone and not the phone's), as the web app does. An all-day
// occurrence is a date (its `start`, and `end` exclusive), never converted, so it stays on the
// day it was created for whatever zone the account uses.

data class AgendaItem(
    val occ: Occurrence,
    val colorHex: String?,
    val startLocal: LocalDateTime,
    val endLocal: LocalDateTime,
    /** When it stops being "current". Never earlier than a minute after it starts. */
    val endInstant: Instant,
) {
    val allDay: Boolean get() = occ.allDay
}

data class AgendaDay(val date: LocalDate, val items: List<AgendaItem>)

/**
 * Days with their items, from today (in [zone]) on. An item that started before today and is still
 * going is listed under today. With [onlyUpcoming] items that have ended by [now] are dropped too.
 */
fun buildAgenda(
    occurrences: List<Occurrence>,
    calendars: List<Calendar>,
    hidden: Set<String>,
    zone: ZoneId,
    now: Instant,
    onlyUpcoming: Boolean,
): List<AgendaDay> {
    val colors = calendars.associate { it.id to it.color }
    val today = now.atZone(zone).toLocalDate()
    val startOfToday = today.atStartOfDay(zone).toInstant()
    val placed = ArrayList<Pair<LocalDate, AgendaItem>>()
    for (o in occurrences) {
        if (o.calendarId in hidden) continue
        val item = itemOf(o, colors[o.calendarId], zone)
        if (!item.endInstant.isAfter(startOfToday)) continue
        if (onlyUpcoming && !item.endInstant.isAfter(now)) continue
        val date = maxOf(item.startLocal.toLocalDate(), today)
        placed += date to item
    }
    return placed
        .groupBy({ it.first }, { it.second })
        .toSortedMap()
        .map { (date, items) ->
            AgendaDay(
                date,
                items.sortedWith(
                    compareBy<AgendaItem>({ !it.allDay }, { it.startLocal }, { it.endLocal }, { it.occ.title.lowercase() }),
                ),
            )
        }
}

private fun itemOf(o: Occurrence, colorHex: String?, zone: ZoneId): AgendaItem {
    if (o.allDay) {
        val start = LocalDate.parse(o.start.take(10))
        val end = LocalDate.parse(o.end.take(10)).let { if (it.isAfter(start)) it else start.plusDays(1) }
        return AgendaItem(o, colorHex, start.atStartOfDay(), end.atStartOfDay(), end.atStartOfDay(zone).toInstant())
    }
    val endUtc = if (o.endUtc.isBefore(o.startUtc.plus(ONE_MINUTE))) o.startUtc.plus(ONE_MINUTE) else o.endUtc
    return AgendaItem(
        o, colorHex,
        o.startUtc.atZone(zone).toLocalDateTime(),
        o.endUtc.atZone(zone).toLocalDateTime(),
        endUtc,
    )
}

private val ONE_MINUTE: Duration = Duration.ofMinutes(1)

// --- Widget ------------------------------------------------------------------------------------

data class WidgetModel(
    val days: List<AgendaDay>,
    val rowCount: Int,
    /** Nothing visible is upcoming in the local copy at all. */
    val empty: Boolean,
    /** Whole hours since the last sync when it is more than three hours ago; null when fresh or never synced. */
    val staleHours: Long?,
    val neverSynced: Boolean,
    /** When the first listed item ends: the widget should redraw then. */
    val nextTick: Instant?,
)

private val STALE_AFTER: Duration = Duration.ofHours(3)

/** Whole hours since the last sync when that is more than three hours ago; null when fresh or never synced. */
fun staleHours(lastSyncAt: Instant?, now: Instant): Long? {
    val age = lastSyncAt?.let { Duration.between(it, now) } ?: return null
    return if (age > STALE_AFTER) age.toHours() else null
}

fun widgetModel(
    occurrences: List<Occurrence>,
    calendars: List<Calendar>,
    hidden: Set<String>,
    zone: ZoneId,
    now: Instant,
    lastSyncAt: Instant?,
    maxRows: Int,
): WidgetModel {
    val all = buildAgenda(occurrences, calendars, hidden, zone, now, onlyUpcoming = true)
    var left = maxRows.coerceAtLeast(1)
    val days = ArrayList<AgendaDay>()
    for (d in all) {
        if (left == 0) break
        val items = d.items.take(left)
        left -= items.size
        days += AgendaDay(d.date, items)
    }
    return WidgetModel(
        days = days,
        rowCount = days.sumOf { it.items.size },
        empty = all.isEmpty(),
        staleHours = staleHours(lastSyncAt, now),
        neverSynced = lastSyncAt == null,
        nextTick = nextTick(days.firstOrNull()?.items?.firstOrNull()?.endInstant, lastSyncAt, now, zone),
    )
}

/**
 * When the widget must be redrawn even if nothing is synced (an offline phone gets no sync to do it for it):
 * the first listed event ends, the copy turns three hours old (then each hour after, so the age keeps up),
 * or the account's day rolls over ("Tomorrow" becomes "Today"). The earliest moment after [now].
 */
fun nextTick(firstEnds: Instant?, lastSyncAt: Instant?, now: Instant, zone: ZoneId): Instant? {
    val staleTick = lastSyncAt?.let {
        val age = Duration.between(it, now)
        val hours = if (age > STALE_AFTER) age.toHours() + 1 else STALE_AFTER.toHours()
        it.plus(Duration.ofHours(hours)).plusSeconds(1)
    }
    val midnight = now.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant()
    return listOfNotNull(firstEnds, staleTick, midnight).filter { it.isAfter(now) }.minOrNull()
}

// --- Text ----------------------------------------------------------------------------------------

data class Labels(val today: String, val tomorrow: String)

val DAY_NAMES = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
val MONTH_NAMES = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

private fun shortDate(d: LocalDate, withYear: Boolean = false): String =
    "${DAY_NAMES[d.dayOfWeek.value - 1]} ${d.dayOfMonth} ${MONTH_NAMES[d.monthValue - 1]}" + if (withYear) " ${d.year}" else ""

/** "Today", "Tomorrow", "Fri 6 Nov", and the year when it is not this year. English names, whatever the phone's language. */
fun dayLabel(date: LocalDate, today: LocalDate, labels: Labels): String = when (date) {
    today -> labels.today
    today.plusDays(1) -> labels.tomorrow
    else -> shortDate(date, withYear = date.year != today.year)
}

private fun clock(t: java.time.LocalTime, clock24: Boolean): String {
    if (clock24) return "%02d:%02d".format(t.hour, t.minute)
    val h = if (t.hour % 12 == 0) 12 else t.hour % 12
    return "%d:%02d %s".format(h, t.minute, if (t.hour < 12) "AM" else "PM")
}

/** The time column of a row listed under [day]. */
fun timeText(item: AgendaItem, day: LocalDate, clock24: Boolean, allDay: String, until: String): String {
    if (item.allDay) return allDay
    val startDate = item.startLocal.toLocalDate()
    val endsAtMidnight = item.endLocal.toLocalTime() == java.time.LocalTime.MIDNIGHT && item.endLocal.toLocalDate() == startDate.plusDays(1)
    val endDate = if (endsAtMidnight) startDate else item.endLocal.toLocalDate()
    val end = clock(item.endLocal.toLocalTime(), clock24)
    return if (startDate == day) {
        val start = clock(item.startLocal.toLocalTime(), clock24)
        if (endDate == startDate) "$start–$end" else "$start–${shortDate(endDate)} $end"
    } else {
        if (endDate == day) "$until $end" else "$until ${shortDate(endDate)}"
    }
}

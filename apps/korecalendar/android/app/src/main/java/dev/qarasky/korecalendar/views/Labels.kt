package dev.qarasky.korecalendar.views

import dev.qarasky.korecalendar.agenda.MONTH_NAMES
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.edit.dateText
import dev.qarasky.korecalendar.edit.monthLong
import java.time.LocalDate
import java.time.ZoneId

/** The title of a view: "Wed 4 Nov 2026", "2–8 Nov 2026", "November 2026". English names, like the agenda's. */
fun periodLabel(view: View, day: LocalDate, ws: WeekStart): String = when (view) {
    View.Day, View.Agenda -> dateText(day)
    View.Month -> "${monthLong(day.monthValue - 1)} ${day.year}"
    View.Week -> {
        val a = startOfWeek(day, ws)
        val b = a.plusDays(6)
        val an = MONTH_NAMES[a.monthValue - 1]
        val bn = MONTH_NAMES[b.monthValue - 1]
        when {
            a.year != b.year -> "${a.dayOfMonth} $an ${a.year} – ${b.dayOfMonth} $bn ${b.year}"
            a.month != b.month -> "${a.dayOfMonth} $an – ${b.dayOfMonth} $bn ${b.year}"
            else -> "${a.dayOfMonth}–${b.dayOfMonth} $bn ${b.year}"
        }
    }
}

/** The label of an hour row: "09:00" or "9 AM". */
fun hourLabel(hour: Int, clock24: Boolean): String = if (clock24) "%02d:00".format(hour) else "${if (hour % 12 == 0) 12 else hour % 12} ${if (hour < 12) "AM" else "PM"}"

/** A tap [minutes] after midnight starts an event at the half hour at or before it. */
fun snapToHalfHour(minutes: Int): Int = (minutes.coerceIn(0, MINUTES_PER_DAY - 1) / 30) * 30

data class Chips<T>(val shown: List<T>, val more: Int)

/** The first [max] items of a month cell and how many did not fit. */
fun <T> chipsForDay(items: List<T>, max: Int): Chips<T> = Chips(items.take(max), maxOf(0, items.size - max))

/** Search results grouped under the (account-zone) day they start, in time order. */
fun groupByStartDay(occs: List<Occurrence>, zone: ZoneId): List<DayGroup> =
    occs.sortedWith(compareBy<Occurrence>({ !it.allDay }, { it.startUtc })).groupBy { if (it.allDay) LocalDate.parse(it.start.take(10)) else it.startUtc.atZone(zone).toLocalDate() }
        .toSortedMap().map { (day, items) -> DayGroup(day, items) }

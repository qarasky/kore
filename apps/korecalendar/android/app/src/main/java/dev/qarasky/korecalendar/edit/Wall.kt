package dev.qarasky.korecalendar.edit

import dev.qarasky.korecalendar.agenda.DAY_NAMES
import dev.qarasky.korecalendar.agenda.MONTH_NAMES
import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/**
 * Wall-clock arithmetic on the API's local time strings (`2026-11-04T16:30:00`, or a date
 * `2026-11-04` for all-day events). Zones play no part: events are edited in their own zone's
 * clock, so adding 90 minutes is adding 90 minutes to the wall reading.
 */
private val WALL: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")

/** A date or date-time string from the API as a wall time (a date is midnight). Throws [IllegalArgumentException] otherwise. */
fun parseWall(s: String): LocalDateTime = try {
    if (s.length == 10) LocalDate.parse(s).atStartOfDay() else LocalDateTime.parse(s)
} catch (e: DateTimeException) {
    throw IllegalArgumentException("not a wall time: $s", e)
}

fun wallString(d: LocalDateTime): String = d.truncatedTo(ChronoUnit.MINUTES).format(WALL)

fun wallString(day: LocalDate, time: LocalTime): String = wallString(day.atTime(time))

/** Whole minutes from [a] to [b] on the wall clock (negative when [b] is earlier). */
fun diffMinutes(a: LocalDateTime, b: LocalDateTime): Long = ChronoUnit.MINUTES.between(a, b)

/** 0 = Sunday … 6 = Saturday, the numbering the rule code uses. */
fun weekday(d: LocalDate): Int = d.dayOfWeek.value % 7

fun weekdayLong(wd: Int): String = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")[wd]

fun weekdayShort(wd: Int): String = DAY_NAMES[(wd + 6) % 7]

fun monthLong(month0: Int): String =
    listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")[month0]

/** "31 Dec 2026". */
fun fullDate(d: LocalDate): String = "${d.dayOfMonth} ${MONTH_NAMES[d.monthValue - 1]} ${d.year}"

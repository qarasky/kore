package dev.qarasky.korecalendar.edit

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit
import java.time.Instant
import java.time.ZoneOffset

/**
 * Recurrence rules for the editor, ported from `web/lib/rrule.ts`. [parseRule] recognises exactly
 * the shapes [buildRule] writes (plus their obvious spellings, such as a bare `FREQ=WEEKLY`);
 * anything else comes back as [Recurrence.Raw] and is passed through untouched, so editing an
 * event never rewrites or drops a rule the editor does not understand. The phone never expands a
 * rule: occurrences come from the server.
 *
 * Weekdays are 0 = Sunday … 6 = Saturday.
 */
enum class Freq { DAILY, WEEKLY, MONTHLY, YEARLY }

enum class MonthlyMode { DayOfMonth, NthWeekday }

sealed interface End {
    data object Never : End
    data class Until(val date: LocalDate) : End
    data class Count(val count: Int) : End
}

sealed interface Recurrence {
    data object None : Recurrence
    data class Rule(val freq: Freq, val interval: Int, val byDay: List<Int>, val monthly: MonthlyMode, val end: End) : Recurrence
    data class Raw(val rrule: String) : Recurrence
}

/** What the rule needs to know about the event it belongs to. */
data class RuleContext(val tz: ZoneId, val allDay: Boolean)

private val CODES = listOf("SU", "MO", "TU", "WE", "TH", "FR", "SA")
private val MONDAY_FIRST = listOf(1, 2, 3, 4, 5, 6, 0)

private fun strip(rule: String): String {
    val r = rule.trim()
    return if (r.startsWith("rrule:", ignoreCase = true)) r.substring(6) else r
}

private fun split(rule: String): Map<String, String>? {
    val out = LinkedHashMap<String, String>()
    for (part in strip(rule).split(";")) {
        val i = part.indexOf('=')
        if (i <= 0) return null
        val key = part.substring(0, i).uppercase()
        if (key in out) return null
        out[key] = part.substring(i + 1)
    }
    return out
}

/** 1–4 for the first to fourth such weekday of its month, -1 for the fifth ("last"). */
fun ordinalOf(start: LocalDate): Int {
    val n = (start.dayOfMonth + 6) / 7
    return if (n == 5) -1 else n
}

private fun isLastWeekdayOfMonth(start: LocalDate) = start.plusDays(7).month != start.month

private fun positiveInt(s: String?): Int? = if (s != null && Regex("\\d+").matches(s) && s.toBigInteger() >= java.math.BigInteger.ONE && s.length < 10) s.toInt() else null

private val UNTIL_UTC = Regex("""^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$""", RegexOption.IGNORE_CASE)

private fun parseUntil(v: String, ctx: RuleContext): LocalDate? {
    if (Regex("\\d{8}").matches(v)) {
        return try {
            LocalDate.parse(v, DateTimeFormatter.BASIC_ISO_DATE)
        } catch (_: DateTimeParseException) {
            null
        }
    }
    val m = UNTIL_UTC.find(v) ?: return null
    return try {
        val instant = java.time.LocalDateTime.of(
            m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt(),
            m.groupValues[4].toInt(), m.groupValues[5].toInt(), m.groupValues[6].toInt(),
        ).toInstant(ZoneOffset.UTC)
        if (ctx.allDay) LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) else instant.atZone(ctx.tz).toLocalDate()
    } catch (_: java.time.DateTimeException) {
        null
    }
}

/** Reads a rule for an event starting on [start]. */
fun parseRule(rrule: String, start: LocalDate, ctx: RuleContext): Recurrence {
    val raw = Recurrence.Raw(rrule)
    if (rrule.isBlank()) return Recurrence.None
    val p = split(rrule) ?: return raw
    val allowed = setOf("FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL")
    if (p.keys.any { it !in allowed }) return raw

    val freq = Freq.entries.firstOrNull { it.name == (p["FREQ"] ?: "").uppercase() } ?: return raw
    val interval = if ("INTERVAL" in p) positiveInt(p["INTERVAL"]) ?: return raw else 1

    var end: End = End.Never
    if ("COUNT" in p && "UNTIL" in p) return raw
    if ("COUNT" in p) {
        end = End.Count(positiveInt(p["COUNT"]) ?: return raw)
    } else if ("UNTIL" in p) {
        end = End.Until(parseUntil(p.getValue("UNTIL"), ctx) ?: return raw)
    }

    val byDay = p["BYDAY"]
    val byMonthDay = p["BYMONTHDAY"]
    val byMonth = p["BYMONTH"]
    fun rule(f: Freq, days: List<Int>, monthly: MonthlyMode) = Recurrence.Rule(f, interval, days, monthly, end)

    return when (freq) {
        Freq.DAILY -> if (byDay != null || byMonthDay != null || byMonth != null) raw else rule(Freq.DAILY, emptyList(), MonthlyMode.DayOfMonth)
        Freq.WEEKLY -> {
            if (byMonthDay != null || byMonth != null) return raw
            if (byDay == null) return rule(Freq.WEEKLY, listOf(weekday(start)), MonthlyMode.DayOfMonth)
            val days = byDay.split(",").map { CODES.indexOf(it.uppercase()) }
            if (days.any { it < 0 } || days.toSet().size != days.size) return raw
            rule(Freq.WEEKLY, days.sorted(), MonthlyMode.DayOfMonth)
        }
        Freq.MONTHLY -> {
            if (byMonth != null) return raw
            if (byDay != null && byMonthDay != null) return raw
            if (byDay == null) {
                if (byMonthDay != null && byMonthDay != start.dayOfMonth.toString()) return raw
                return rule(Freq.MONTHLY, emptyList(), MonthlyMode.DayOfMonth)
            }
            val m = Regex("""^(-?\d)([A-Za-z]{2})$""").find(byDay) ?: return raw
            if (CODES.indexOf(m.groupValues[2].uppercase()) != weekday(start)) return raw
            val n = m.groupValues[1].toInt()
            val fits = n == ordinalOf(start) || (n == -1 && isLastWeekdayOfMonth(start))
            if (fits) rule(Freq.MONTHLY, emptyList(), MonthlyMode.NthWeekday) else raw
        }
        Freq.YEARLY -> {
            if (byDay != null) return raw
            if ((byMonth == null) != (byMonthDay == null)) return raw
            if (byMonth != null && (byMonth != start.monthValue.toString() || byMonthDay != start.dayOfMonth.toString())) return raw
            rule(Freq.YEARLY, emptyList(), MonthlyMode.DayOfMonth)
        }
    }
}

private val UNTIL_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC)

private fun untilValue(date: LocalDate, ctx: RuleContext): String {
    if (ctx.allDay) return date.format(DateTimeFormatter.BASIC_ISO_DATE)
    // The end of that local day, as an instant in UTC (23:59:59 local). A wall time that happens twice means the first.
    val instant: Instant = ZonedDateTime.ofLocal(date.atTime(23, 59), ctx.tz, null).toInstant().plus(59, ChronoUnit.SECONDS)
    return UNTIL_FORMAT.format(instant)
}

/** Writes the rule text the API takes; "" for no repeat; a raw rule as it is. Throws [IllegalArgumentException] for values the API would refuse. */
fun buildRule(r: Recurrence, start: LocalDate, ctx: RuleContext): String {
    when (r) {
        Recurrence.None -> return ""
        is Recurrence.Raw -> return r.rrule
        is Recurrence.Rule -> Unit
    }
    require(r.interval >= 1) { "interval must be a whole number of at least 1" }
    (r.end as? End.Count)?.let { require(it.count >= 1) { "count must be a whole number of at least 1" } }

    val parts = mutableListOf("FREQ=${r.freq}")
    if (r.interval > 1) parts += "INTERVAL=${r.interval}"
    when (r.freq) {
        Freq.WEEKLY -> {
            require(r.byDay.isNotEmpty()) { "choose at least one weekday" }
            parts += "BYDAY=" + MONDAY_FIRST.filter { it in r.byDay }.joinToString(",") { CODES[it] }
        }
        Freq.MONTHLY -> parts += if (r.monthly == MonthlyMode.NthWeekday) "BYDAY=${ordinalOf(start)}${CODES[weekday(start)]}" else "BYMONTHDAY=${start.dayOfMonth}"
        else -> Unit
    }
    when (val e = r.end) {
        is End.Count -> parts += "COUNT=${e.count}"
        is End.Until -> parts += "UNTIL=${untilValue(e.date, ctx)}"
        End.Never -> Unit
    }
    return parts.joinToString(";")
}

private fun base(freq: Freq) = Recurrence.Rule(freq, 1, emptyList(), MonthlyMode.DayOfMonth, End.Never)

data class Preset(val id: String, val label: String, val recurrence: Recurrence)

private fun ordinalWord(n: Int, msg: Messages) = msg.get(if (n == -1) "rrule_ordinal_last" else "rrule_ordinal_$n")

/** The quick choices for an event that starts on [start]. */
fun presets(start: LocalDate, msg: Messages): List<Preset> {
    val wd = weekday(start)
    return listOf(
        Preset("none", msg.get("rrule_none"), Recurrence.None),
        Preset("daily", msg.get("rrule_daily"), base(Freq.DAILY)),
        Preset("weekly", msg.get("rrule_weekly_on", weekdayLong(wd)), base(Freq.WEEKLY).copy(byDay = listOf(wd))),
        Preset("monthly-day", msg.get("rrule_monthly_day", start.dayOfMonth), base(Freq.MONTHLY)),
        Preset(
            "monthly-nth",
            msg.get("rrule_monthly_nth", ordinalWord(ordinalOf(start), msg), weekdayLong(wd)),
            base(Freq.MONTHLY).copy(monthly = MonthlyMode.NthWeekday),
        ),
        Preset("yearly", msg.get("rrule_yearly", "${start.dayOfMonth} ${monthLong(start.monthValue - 1)}"), base(Freq.YEARLY)),
        Preset("weekdays", msg.get("rrule_weekdays"), base(Freq.WEEKLY).copy(byDay = listOf(1, 2, 3, 4, 5))),
    )
}

/** [r] for a new event whose start moved from [from] to [to]: a preset ("every week on Tuesday") follows the new date, anything else stays. */
fun rebased(r: Recurrence, from: LocalDate, to: LocalDate): Recurrence {
    val noText = Messages { key, _ -> key }
    val id = presets(from, noText).firstOrNull { it.recurrence == r }?.id ?: return r
    return presets(to, noText).first { it.id == id }.recurrence
}

/** The id of the preset [r] equals, or null when it is a custom rule. */
fun matchPreset(r: Recurrence, start: LocalDate, msg: Messages): String? = presets(start, msg).firstOrNull { it.recurrence == r }?.id

/** A sentence for a rule: "Every week on Wed, Fri, until 31 Dec 2026". */
fun describeRule(rrule: String, start: LocalDate, ctx: RuleContext, msg: Messages): String {
    val r = when (val parsed = parseRule(rrule, start, ctx)) {
        Recurrence.None -> return msg.get("rrule_none")
        is Recurrence.Raw -> return msg.get("rrule_custom", strip(parsed.rrule))
        is Recurrence.Rule -> parsed
    }
    val n = r.interval
    val date = "${start.dayOfMonth} ${monthLong(start.monthValue - 1)}"
    var text = when (r.freq) {
        Freq.DAILY -> if (n == 1) msg.get("rrule_daily") else msg.get("rrule_daily_n", n)
        Freq.WEEKLY -> {
            val days = MONDAY_FIRST.filter { it in r.byDay }.joinToString(", ") { weekdayShort(it) }
            if (n == 1) msg.get("rrule_weekly_on", days) else msg.get("rrule_weekly_n_on", n, days)
        }
        Freq.MONTHLY ->
            if (r.monthly == MonthlyMode.NthWeekday) {
                val ord = ordinalWord(ordinalOf(start), msg)
                val day = weekdayLong(weekday(start))
                if (n == 1) msg.get("rrule_monthly_nth", ord, day) else msg.get("rrule_monthly_nth_n", n, ord, day)
            } else {
                if (n == 1) msg.get("rrule_monthly_day", start.dayOfMonth) else msg.get("rrule_monthly_day_n", n, start.dayOfMonth)
            }
        Freq.YEARLY -> if (n == 1) msg.get("rrule_yearly", date) else msg.get("rrule_yearly_n", n, date)
    }
    when (val e = r.end) {
        is End.Count -> text += ", " + msg.get("rrule_times", e.count)
        is End.Until -> text += ", " + msg.get("rrule_until", fullDate(e.date))
        End.Never -> Unit
    }
    return text
}

/**
 * The rule after the whole series moves by [dayDelta] days (so its start is `start + dayDelta`):
 * weekdays rotate, day-of-month and yearly rules follow the new start. Null when the shape cannot
 * be moved safely (nth weekdays, custom rules): the caller then offers only "this event".
 */
fun shiftRuleByDays(rrule: String, dayDelta: Int, start: LocalDate, ctx: RuleContext): String? {
    if (dayDelta == 0) return rrule
    val r = when (val parsed = parseRule(rrule, start, ctx)) {
        Recurrence.None -> return rrule
        is Recurrence.Raw -> return null
        is Recurrence.Rule -> parsed
    }
    val moved = start.plusDays(dayDelta.toLong())
    return when (r.freq) {
        Freq.DAILY -> rrule
        Freq.WEEKLY -> buildRule(r.copy(byDay = r.byDay.map { Math.floorMod(it + dayDelta, 7) }.sorted()), moved, ctx)
        Freq.MONTHLY -> if (r.monthly == MonthlyMode.NthWeekday) null else buildRule(r, moved, ctx)
        Freq.YEARLY -> buildRule(r, moved, ctx)
    }
}

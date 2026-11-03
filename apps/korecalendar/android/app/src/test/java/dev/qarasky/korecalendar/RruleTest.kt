package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.edit.End
import dev.qarasky.korecalendar.edit.Freq
import dev.qarasky.korecalendar.edit.MonthlyMode
import dev.qarasky.korecalendar.edit.Recurrence
import dev.qarasky.korecalendar.edit.RuleContext
import dev.qarasky.korecalendar.edit.buildRule
import dev.qarasky.korecalendar.edit.describeRule
import dev.qarasky.korecalendar.edit.parseRule
import dev.qarasky.korecalendar.edit.presets
import dev.qarasky.korecalendar.edit.shiftRuleByDays
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** Ported from web/lib/__tests__/rrule.test.ts: the phone writes and reads exactly the rules the web editor does. */
class RruleTest {
    private val wed = LocalDate.parse("2026-11-04") // a Wednesday, the 4th: the first Wednesday
    private val opts = RuleContext(ZoneId.of("Europe/Berlin"), allDay = false)

    private fun rule(freq: Freq, byDay: List<Int> = emptyList(), interval: Int = 1, monthly: MonthlyMode = MonthlyMode.DayOfMonth, end: End = End.Never) =
        Recurrence.Rule(freq, interval, byDay, monthly, end)

    private fun weekly(byDay: List<Int>, interval: Int = 1, end: End = End.Never) = rule(Freq.WEEKLY, byDay, interval, end = end)
    private fun parse(r: String, start: LocalDate = wed, ctx: RuleContext = opts) = parseRule(r, start, ctx)

    @Test fun readsDailyWeeklyMonthlyYearly() {
        assertEquals(rule(Freq.DAILY), parse("FREQ=DAILY"))
        assertEquals(rule(Freq.DAILY, interval = 3), parse("FREQ=DAILY;INTERVAL=3"))
        assertEquals(weekly(listOf(3, 5)), parse("FREQ=WEEKLY;BYDAY=WE,FR"))
        assertEquals(weekly(listOf(1), interval = 2), parse("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"))
        assertEquals(rule(Freq.MONTHLY), parse("FREQ=MONTHLY;BYMONTHDAY=4"))
        assertEquals(rule(Freq.MONTHLY, monthly = MonthlyMode.NthWeekday), parse("FREQ=MONTHLY;BYDAY=1WE"))
        assertEquals(rule(Freq.YEARLY), parse("FREQ=YEARLY"))
    }

    @Test fun aPlainWeeklyIsTheStartsWeekdayAndAPlainMonthlyTheStartsDay() {
        assertEquals(weekly(listOf(3)), parse("FREQ=WEEKLY"))
        assertEquals(rule(Freq.MONTHLY), parse("FREQ=MONTHLY"))
    }

    @Test fun toleratesAnRruleColonPrefix() {
        assertEquals(weekly(listOf(3)), parse("RRULE:FREQ=WEEKLY;BYDAY=WE"))
    }

    @Test fun readsCountAndUntilAsTheEnd() {
        assertEquals(rule(Freq.DAILY, end = End.Count(10)), parse("FREQ=DAILY;COUNT=10"))
        assertEquals(rule(Freq.DAILY, end = End.Until(LocalDate.parse("2026-12-31"))), parse("FREQ=DAILY;UNTIL=20261231", ctx = RuleContext(ZoneId.of("UTC"), true)))
        // a timed series ends at the end of the local day, written in UTC
        assertEquals(rule(Freq.DAILY, end = End.Until(LocalDate.parse("2026-12-31"))), parse("FREQ=DAILY;UNTIL=20261231T225959Z"))
    }

    @Test fun shapesItCannotExpressStayRaw() {
        for (r in listOf(
            "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
            "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
            "FREQ=WEEKLY;BYDAY=WE,FR;WKST=SU",
            "FREQ=MONTHLY;BYMONTHDAY=4,18",
            "FREQ=MONTHLY;BYMONTHDAY=5", // not the start's day
            "FREQ=MONTHLY;BYDAY=2WE", // the start is the first Wednesday, not the second
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
            "FREQ=WEEKLY;BYDAY=2WE",
            "FREQ=DAILY;COUNT=0",
            "FREQ=DAILY;COUNT=2;UNTIL=20261231",
            "FREQ=DAILY;FREQ=WEEKLY",
            "FREQ=HOURLY",
            "garbage",
            "FREQ=DAILY;BYHOUR=9",
        )) assertEquals(r, Recurrence.Raw(r), parse(r))
    }

    @Test fun anEmptyRuleIsNone() = assertEquals(Recurrence.None, parse(""))

    @Test fun neverRewritesARawRule() {
        val r = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"
        val parsed = parse(r, LocalDate.parse("2026-10-30"))
        assertEquals(Recurrence.Raw(r), parsed)
        assertEquals(r, buildRule(parsed, LocalDate.parse("2026-10-30"), opts))
    }

    @Test fun buildsEachShapeTheApiAccepts() {
        assertEquals("", buildRule(Recurrence.None, wed, opts))
        assertEquals("FREQ=WEEKLY;BYDAY=WE,FR", buildRule(weekly(listOf(3, 5)), wed, opts))
        assertEquals("FREQ=WEEKLY;BYDAY=WE,FR", buildRule(weekly(listOf(5, 3)), wed, opts))
        assertEquals("FREQ=WEEKLY;BYDAY=MO,SU", buildRule(weekly(listOf(0, 1)), wed, opts)) // Monday first
        assertEquals("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", buildRule(weekly(listOf(1), interval = 2), wed, opts))
        assertEquals("FREQ=DAILY", buildRule(rule(Freq.DAILY), wed, opts))
        assertEquals("FREQ=MONTHLY;BYMONTHDAY=4", buildRule(rule(Freq.MONTHLY), wed, opts))
        assertEquals("FREQ=MONTHLY;BYDAY=1WE", buildRule(rule(Freq.MONTHLY, monthly = MonthlyMode.NthWeekday), wed, opts))
        assertEquals("FREQ=YEARLY", buildRule(rule(Freq.YEARLY), wed, opts))
    }

    @Test fun usesTheLastWeekdayWhenTheStartIsTheFifthOne() {
        val fifth = LocalDate.parse("2026-09-30") // the 5th Wednesday of September 2026
        val r = rule(Freq.MONTHLY, monthly = MonthlyMode.NthWeekday)
        assertEquals("FREQ=MONTHLY;BYDAY=-1WE", buildRule(r, fifth, opts))
        assertEquals(r, parse("FREQ=MONTHLY;BYDAY=-1WE", fifth))
    }

    @Test fun writesCountAndUntil() {
        assertEquals("FREQ=WEEKLY;BYDAY=WE;COUNT=5", buildRule(weekly(listOf(3), end = End.Count(5)), wed, opts))
        val until = weekly(listOf(3), end = End.Until(LocalDate.parse("2026-12-31")))
        assertEquals("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T225959Z", buildRule(until, wed, opts))
        assertEquals("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231", buildRule(until, wed, RuleContext(ZoneId.of("UTC"), true)))
    }

    @Test fun roundTripsEveryPreset() {
        for (p in presets(wed, TestMessages)) assertEquals(p.id, p.recurrence, parse(buildRule(p.recurrence, wed, opts)))
    }

    @Test fun roundTripsRulesWithEndsAndIntervals() {
        for (r in listOf(
            weekly(listOf(1, 3, 5), interval = 2, end = End.Count(8)),
            weekly(listOf(3), end = End.Until(LocalDate.parse("2027-03-01"))),
        )) assertEquals(r, parse(buildRule(r, wed, opts)))
    }

    @Test fun rejectsValuesTheApiWouldRefuse() {
        assertThrows(IllegalArgumentException::class.java) { buildRule(weekly(listOf(3), interval = 0), wed, opts) }
        assertThrows(IllegalArgumentException::class.java) { buildRule(weekly(listOf(3), end = End.Count(0)), wed, opts) }
        assertThrows(IllegalArgumentException::class.java) { buildRule(weekly(emptyList()), wed, opts) }
    }

    @Test fun presetsAreWordedForTheStartDate() {
        assertEquals(
            listOf(
                "Doesn't repeat", "Every day", "Every week on Wednesday", "Every month on day 4",
                "Every month on the first Wednesday", "Every year on 4 November", "Every weekday (Mon–Fri)",
            ),
            presets(wed, TestMessages).map { it.label },
        )
        assertEquals(true, presets(LocalDate.parse("2026-09-30"), TestMessages).any { it.label == "Every month on the last Wednesday" })
    }

    @Test fun describesARuleAsASentence() {
        fun d(r: String) = describeRule(r, wed, opts, TestMessages)
        assertEquals("Doesn't repeat", d(""))
        assertEquals("Every day", d("FREQ=DAILY"))
        assertEquals("Every 2 days", d("FREQ=DAILY;INTERVAL=2"))
        assertEquals("Every week on Wed, Fri", d("FREQ=WEEKLY;BYDAY=WE,FR"))
        assertEquals("Every 2 weeks on Mon", d("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO"))
        assertEquals("Every month on day 4", d("FREQ=MONTHLY;BYMONTHDAY=4"))
        assertEquals("Every year on 4 November", d("FREQ=YEARLY"))
        assertEquals("Every week on Wed, 10 times", d("FREQ=WEEKLY;BYDAY=WE;COUNT=10"))
        assertEquals("Every week on Wed, until 31 Dec 2026", d("FREQ=WEEKLY;BYDAY=WE;UNTIL=20261231T225959Z"))
        assertEquals("Custom rule: FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", d("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"))
    }

    @Test fun shiftRotatesWeekdays() {
        assertEquals("FREQ=WEEKLY;BYDAY=TH,SA", shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE,FR", 1, wed, opts))
        assertEquals("FREQ=WEEKLY;BYDAY=TU,SU", shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE,FR", -3, wed, opts))
        assertEquals("FREQ=WEEKLY;BYDAY=MO,TU", shiftRuleByDays("FREQ=WEEKLY;BYDAY=SA,SU", 2, LocalDate.parse("2026-11-07"), opts))
    }

    @Test fun shiftMovesTheMonthlyDay() {
        assertEquals("FREQ=MONTHLY;BYMONTHDAY=7", shiftRuleByDays("FREQ=MONTHLY;BYMONTHDAY=4", 3, wed, opts))
        assertEquals("FREQ=MONTHLY;BYMONTHDAY=3", shiftRuleByDays("FREQ=MONTHLY;BYMONTHDAY=30", 3, LocalDate.parse("2026-11-30"), opts))
    }

    @Test fun shiftLeavesDailyAndYearly() {
        assertEquals("FREQ=DAILY;INTERVAL=2", shiftRuleByDays("FREQ=DAILY;INTERVAL=2", 5, wed, opts))
        assertEquals("FREQ=YEARLY", shiftRuleByDays("FREQ=YEARLY", 1, wed, opts))
    }

    @Test fun shiftKeepsTheEnd() = assertEquals("FREQ=WEEKLY;BYDAY=TH;COUNT=5", shiftRuleByDays("FREQ=WEEKLY;BYDAY=WE;COUNT=5", 1, wed, opts))

    @Test fun shiftIsNullWhenARuleCannotMoveSafely() {
        assertNull(shiftRuleByDays("FREQ=MONTHLY;BYDAY=1WE", 1, wed, opts))
        assertNull(shiftRuleByDays("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1", 1, wed, opts))
    }

    @Test fun shiftByZeroIsTheIdentity() {
        val r = "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"
        assertEquals(r, shiftRuleByDays(r, 0, wed, opts))
    }
}

package dev.qarasky.korecalendar.views

import dev.qarasky.korecalendar.data.Occurrence
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Where events go on the day, week and month views. Pure, ported from `web/lib/layout.ts` and `agenda.ts`.
 *
 * The grid is a wall-clock grid: 24 hour rows in the account's zone, every day the same shape. An event sits where
 * its start and end read on the wall clock (so on a daylight-saving day the gap hour is still a row), and `top` and
 * `height` are in minutes of that clock.
 */
const val MINUTES_PER_DAY = 1440

/** The shortest an event is drawn, so a 5-minute event can still be seen and tapped. */
const val MIN_HEIGHT = 15

data class Placed(
    val occ: Occurrence,
    val day: LocalDate,
    /** Minutes after midnight (wall clock). */
    val top: Int,
    /** Minutes, at least [MIN_HEIGHT]. */
    val height: Int,
    /** Column among the events it overlaps, from 0. */
    val col: Int,
    /** How many columns that group of overlapping events has. */
    val cols: Int,
    /** How many columns wide it is drawn (more than 1 when the columns to its right are free). */
    val span: Int,
    val continuesBefore: Boolean,
    val continuesAfter: Boolean,
)

private data class Segment(val occ: Occurrence, val day: LocalDate, val top: Int, val height: Int, val continuesBefore: Boolean, val continuesAfter: Boolean)

private fun overlaps(a: Segment, b: Segment) = a.top < b.top + b.height && b.top < a.top + a.height

private fun identity(o: Occurrence) = "${o.eventId}|${o.key}"

/** One segment per visible day each timed occurrence touches. */
private fun segmentsOf(occ: Occurrence, days: List<LocalDate>, zone: ZoneId): List<Segment> {
    val s = occ.startUtc.atZone(zone)
    val e = occ.endUtc.atZone(zone)
    val sDay = s.toLocalDate()
    val sMin = s.hour * 60 + s.minute
    var endDay = e.toLocalDate()
    var endMin = e.hour * 60 + e.minute
    if (endMin == 0 && endDay.isAfter(sDay)) {
        // Ends exactly at midnight: the end of the previous day, not a sliver of the next.
        endDay = endDay.minusDays(1)
        endMin = MINUTES_PER_DAY
    }
    val first = if (sDay.isBefore(days.first())) days.first() else sDay
    val last = if (endDay.isAfter(days.last())) days.last() else endDay
    val out = ArrayList<Segment>()
    var d = first
    while (!d.isAfter(last)) {
        if (d in days) {
            val startMin = if (d == sDay) sMin else 0
            val endM = if (d == endDay) endMin else MINUTES_PER_DAY
            val height = maxOf(endM - startMin, MIN_HEIGHT)
            out += Segment(occ, d, minOf(startMin, MINUTES_PER_DAY - height), height, d != sDay, d != endDay)
        }
        d = d.plusDays(1)
    }
    return out
}

/** Splits a day's segments into clusters of transitively overlapping events and assigns each a column. */
private fun columnsFor(segs: List<Segment>): List<Placed> {
    val sorted = segs.sortedWith(compareBy<Segment>({ it.top }, { -it.height }, { identity(it.occ) }))
    val placed = ArrayList<Placed>()
    var cluster = ArrayList<Segment>()
    var clusterEnd = -1

    fun flush() {
        if (cluster.isEmpty()) return
        val colEnds = ArrayList<Int>()
        val cols = cluster.map { seg ->
            var c = colEnds.indexOfFirst { it <= seg.top }
            if (c == -1) c = colEnds.size
            if (c == colEnds.size) colEnds += 0
            colEnds[c] = seg.top + seg.height
            c
        }
        cluster.forEachIndexed { i, seg ->
            var span = 1
            var c = cols[i] + 1
            while (c < colEnds.size) {
                val blocked = cluster.indices.any { j -> cols[j] == c && overlaps(seg, cluster[j]) }
                if (blocked) break
                span++
                c++
            }
            placed += Placed(seg.occ, seg.day, seg.top, seg.height, cols[i], colEnds.size, span, seg.continuesBefore, seg.continuesAfter)
        }
        cluster = ArrayList()
    }

    for (seg in sorted) {
        if (seg.top >= clusterEnd) flush()
        cluster += seg
        clusterEnd = if (cluster.size == 1) seg.top + seg.height else maxOf(clusterEnd, seg.top + seg.height)
    }
    flush()
    return placed
}

/** Places the timed occurrences on the given [days], in the person's [zone]. */
fun placeTimed(occs: List<Occurrence>, days: List<LocalDate>, zone: ZoneId): List<Placed> {
    if (days.isEmpty()) return emptyList()
    val byDay = HashMap<LocalDate, MutableList<Segment>>()
    for (occ in occs) {
        if (occ.allDay) continue
        for (seg in segmentsOf(occ, days, zone)) byDay.getOrPut(seg.day) { ArrayList() } += seg
    }
    return days.flatMap { columnsFor(byDay[it] ?: emptyList()) }
}

data class AllDayPlaced(
    val occ: Occurrence,
    /** Index of the first visible day it covers. */
    val startIdx: Int,
    val span: Int,
    val lane: Int,
    val clippedBefore: Boolean,
    val clippedAfter: Boolean,
)

/** Places the all-day occurrences as bars across the visible [days], packed into lanes. */
fun placeAllDay(occs: List<Occurrence>, days: List<LocalDate>): List<AllDayPlaced> {
    if (days.isEmpty()) return emptyList()
    data class Item(val occ: Occurrence, val startIdx: Int, val span: Int, val before: Boolean, val after: Boolean)
    val items = ArrayList<Item>()
    for (occ in occs) {
        if (!occ.allDay) continue
        val start = ChronoUnit.DAYS.between(days.first(), LocalDate.parse(occ.start.take(10))).toInt()
        val end = maxOf(ChronoUnit.DAYS.between(days.first(), LocalDate.parse(occ.end.take(10))).toInt(), start + 1) // end is exclusive
        if (end <= 0 || start >= days.size) continue
        val startIdx = maxOf(0, start)
        val endIdx = minOf(days.size, end)
        items += Item(occ, startIdx, endIdx - startIdx, start < 0, end > days.size)
    }
    items.sortWith(compareBy<Item>({ it.startIdx }, { -it.span }, { identity(it.occ) }))
    val laneEnds = ArrayList<Int>()
    return items.map { item ->
        var lane = laneEnds.indexOfFirst { it <= item.startIdx }
        if (lane == -1) {
            lane = laneEnds.size
            laneEnds += 0
        }
        laneEnds[lane] = item.startIdx + item.span
        AllDayPlaced(item.occ, item.startIdx, item.span, lane, item.before, item.after)
    }
}

/** First and last local day an occurrence touches (inclusive). */
fun occurrenceDays(occ: Occurrence, zone: ZoneId): Pair<LocalDate, LocalDate> {
    if (occ.allDay) {
        val first = LocalDate.parse(occ.start.take(10))
        val last = LocalDate.parse(occ.end.take(10)).minusDays(1)
        return first to (if (last.isBefore(first)) first else last)
    }
    val s = occ.startUtc.atZone(zone)
    val e = occ.endUtc.atZone(zone)
    val sDay = s.toLocalDate()
    // Ending exactly at midnight is the end of the previous day, not a sliver of the next.
    val last = if (e.hour == 0 && e.minute == 0 && e.toLocalDate().isAfter(sDay)) e.toLocalDate().minusDays(1) else e.toLocalDate()
    return sDay to (if (last.isBefore(sDay)) sDay else last)
}

private fun startKey(occ: Occurrence, day: LocalDate, zone: ZoneId): Int {
    if (occ.allDay) return -2
    val s = occ.startUtc.atZone(zone)
    return if (s.toLocalDate() == day) s.hour * 60 + s.minute else -1 // continued from an earlier day: before that day's own starts
}

data class DayGroup(val day: LocalDate, val items: List<Occurrence>)

/** One group per requested day (empty days included); an occurrence appears on every day it covers. All-day first, then by start, then by title. */
fun groupByDay(occs: List<Occurrence>, days: List<LocalDate>, zone: ZoneId): List<DayGroup> {
    if (days.isEmpty()) return emptyList()
    val groups = days.associateWith { ArrayList<Occurrence>() }
    for (occ in occs) {
        val (first, last) = occurrenceDays(occ, zone)
        var d = if (first.isBefore(days.first())) days.first() else first
        val to = if (last.isAfter(days.last())) days.last() else last
        while (!d.isAfter(to)) {
            groups[d]?.add(occ)
            d = d.plusDays(1)
        }
    }
    return days.map { day ->
        DayGroup(day, groups.getValue(day).sortedWith(compareBy<Occurrence>({ startKey(it, day, zone) }, { it.title.lowercase() }, { it.eventId + it.key })))
    }
}

package dev.qarasky.korecalendar.views

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.LocalStore
import dev.qarasky.korecalendar.data.NetworkException
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.sync.KEPT_SPAN
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** The views, as on the web: the Agenda, one day, one week (seven days) and a month grid. */
enum class View(val wire: String) {
    Agenda("agenda"), Day("day"), Week("week"), Month("month");

    companion object {
        fun parse(s: String?): View? = entries.firstOrNull { it.wire == s }
    }
}

enum class WeekStart(val wire: String, val first: DayOfWeek) {
    Mon("mon", DayOfWeek.MONDAY), Sun("sun", DayOfWeek.SUNDAY), Sat("sat", DayOfWeek.SATURDAY);

    companion object {
        fun parse(s: String?): WeekStart? = entries.firstOrNull { it.wire == s }
    }
}

fun startOfWeek(day: LocalDate, ws: WeekStart): LocalDate = day.minusDays(Math.floorMod(day.dayOfWeek.value - ws.first.value, 7).toLong())

/** Six rows of seven days covering the month of [day], starting on the week start. */
fun monthGrid(day: LocalDate, ws: WeekStart): List<List<LocalDate>> {
    val first = startOfWeek(day.withDayOfMonth(1), ws)
    return List(6) { row -> List(7) { col -> first.plusDays((row * 7 + col).toLong()) } }
}

/** The days a view shows around [day]. The Agenda has its own list. */
fun viewDays(view: View, day: LocalDate, ws: WeekStart): List<LocalDate> = when (view) {
    View.Day, View.Agenda -> listOf(day)
    View.Week -> startOfWeek(day, ws).let { s -> List(7) { s.plusDays(it.toLong()) } }
    View.Month -> monthGrid(day, ws).flatten()
}

data class ViewRange(val days: List<LocalDate>, val from: Instant, val to: Instant)

/** Local midnight of the first day to local midnight after the last, in [zone]. */
fun viewRange(view: View, day: LocalDate, zone: ZoneId, ws: WeekStart): ViewRange {
    val days = viewDays(view, day, ws)
    return ViewRange(days, days.first().atStartOfDay(zone).toInstant(), days.last().plusDays(1).atStartOfDay(zone).toInstant())
}

/** The day to show after pressing previous (-1) or next (1); 0 keeps [day]. */
fun navigate(view: View, day: LocalDate, dir: Int): LocalDate = when (view) {
    View.Day -> day.plusDays(dir.toLong())
    View.Week -> day.plusDays(7L * dir)
    View.Month -> day.plusMonths(dir.toLong())
    View.Agenda -> day.plusDays(30L * dir)
}

data class RangeResult(val occurrences: List<Occurrence>, val fromServer: Boolean, val offline: Boolean)

private fun overlapping(all: List<Occurrence>, from: Instant, to: Instant) = all.filter { it.startUtc < to && it.endUtc > from || (it.startUtc == it.endUtc && it.startUtc >= from && it.startUtc < to) }

/**
 * What a view shows for a range of time. Inside the window the phone keeps (14 days back, 60 ahead) it is the local
 * copy, so views open instantly and offline. Outside it the server is asked (and the answer remembered until
 * [forget], not stored); when the server cannot be reached the phone shows what it has and says so.
 */
class RangeSource(private val api: () -> CalendarApi?, private val store: LocalStore) {
    private val remembered = LinkedHashMap<Pair<Instant, Instant>, List<Occurrence>>()

    @Synchronized fun forget() = remembered.clear()

    @Synchronized private fun recall(k: Pair<Instant, Instant>) = remembered[k]

    @Synchronized private fun keep(k: Pair<Instant, Instant>, v: List<Occurrence>) {
        if (remembered.size >= 8) remembered.remove(remembered.keys.first())
        remembered[k] = v
    }

    suspend fun load(from: Instant, to: Instant): RangeResult {
        val windowFrom = store.windowFrom()
        val local = store.snapshot().occurrences
        if (windowFrom != null && from >= windowFrom && to <= windowFrom.plus(KEPT_SPAN)) {
            return RangeResult(overlapping(local, from, to), fromServer = false, offline = false)
        }
        recall(from to to)?.let { return RangeResult(it, fromServer = true, offline = false) }
        val client = api() ?: return RangeResult(overlapping(local, from, to), fromServer = false, offline = true)
        return try {
            val got = client.occurrences(from, to)
            keep(from to to, got)
            RangeResult(got, fromServer = true, offline = false)
        } catch (e: NetworkException) {
            RangeResult(overlapping(local, from, to), fromServer = false, offline = true)
        } catch (e: ApiException) {
            // The server answered with an error (a gateway down, a token revoked): show what the phone has, never crash a view.
            RangeResult(overlapping(local, from, to), fromServer = false, offline = true)
        }
    }
}

data class SearchResult(val occurrences: List<Occurrence>, val offline: Boolean, val from: LocalDate, val to: LocalDate)

/** Search looks 90 days back and 300 days ahead, as the web does (the API allows 400 days per request); offline it searches the phone's copy. */
class SearchSource(private val api: () -> CalendarApi?, private val store: LocalStore, private val zone: ZoneId, private val now: () -> Instant) {
    suspend fun search(raw: String): SearchResult {
        val q = raw.trim().take(200)
        val today = now().atZone(zone).toLocalDate()
        val first = today.minusDays(90)
        val last = today.plusDays(300)
        if (q.isEmpty()) return SearchResult(emptyList(), offline = false, first, last)
        val from = first.atStartOfDay(zone).toInstant()
        val to = last.plusDays(1).atStartOfDay(zone).toInstant()
        val client = api()
        if (client != null) {
            try {
                return SearchResult(client.occurrences(from, to, q), offline = false, first, last)
            } catch (e: NetworkException) {
                // fall through to the local copy
            } catch (e: ApiException) {
                // an error answer (a gateway down, too many hits for the range): search the phone's copy instead
            }
        }
        val needle = q.lowercase()
        val hits = store.snapshot().occurrences.filter {
            it.title.lowercase().contains(needle) || it.notes.lowercase().contains(needle) || it.location.lowercase().contains(needle)
        }.sortedBy { it.startUtc }
        return SearchResult(hits, offline = true, first, last)
    }
}

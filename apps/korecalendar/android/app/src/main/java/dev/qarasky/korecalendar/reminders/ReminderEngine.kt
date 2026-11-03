package dev.qarasky.korecalendar.reminders

import dev.qarasky.korecalendar.data.Occurrence
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** One reminder of one occurrence: [at] is when it goes off. [id] is stable for the same occurrence and lead time. */
data class ReminderTrigger(
    val id: String,
    val at: Instant,
    val eventId: String,
    val key: String,
    val title: String,
    val location: String,
    val startUtc: Instant,
    val allDay: Boolean,
    val minutesBefore: Int,
)

/**
 * Works out the reminders from the phone's own copy of the occurrences (never from the network): no push service is needed, the
 * alarms are set locally. Pure, so it is tested on the JVM; scheduling and notifying are in `ReminderRunner`.
 *
 * Hidden calendars are not muted: pass every occurrence, hidden or not.
 */
class ReminderEngine(private val horizon: Duration = Duration.ofDays(7)) {

    private fun triggersOf(o: Occurrence): List<ReminderTrigger> {
        // An all-day event counts back from midnight of its first day in the event's own zone; a timed one from its start.
        val base = if (o.allDay) {
            val zone = try { ZoneId.of(o.tz) } catch (_: Exception) { ZoneId.of("UTC") }
            LocalDate.parse(o.start.take(10)).atStartOfDay(zone).toInstant()
        } else {
            o.startUtc
        }
        return o.reminders.map { r ->
            ReminderTrigger(
                id = "${o.eventId}|${o.key}|${r.minutesBefore}", at = base.minus(Duration.ofMinutes(r.minutesBefore.toLong())),
                eventId = o.eventId, key = o.key, title = o.title, location = o.location, startUtc = o.startUtc, allDay = o.allDay, minutesBefore = r.minutesBefore,
            )
        }
    }

    private fun all(occs: List<Occurrence>) = occs.flatMap { triggersOf(it) }.sortedWith(compareBy({ it.at }, { it.id }))

    /** Reminders strictly after [now], within the horizon, in time order. */
    fun upcoming(occs: List<Occurrence>, now: Instant): List<ReminderTrigger> {
        val limit = now.plus(horizon)
        return all(occs).filter { it.at.isAfter(now) && !it.at.isAfter(limit) }
    }

    fun next(occs: List<Occurrence>, now: Instant): ReminderTrigger? = upcoming(occs, now).firstOrNull()

    /**
     * What should be shown now: reminders whose time fell in `(lastCheck, now]` and whose event has not ended (a reminder missed while
     * the phone was off still shows, once, as long as it is still useful). Every check moves [lastCheck] to [now], so nothing shows twice.
     */
    fun due(occs: List<Occurrence>, lastCheck: Instant, now: Instant): List<ReminderTrigger> {
        val ends = occs.associate { "${it.eventId}|${it.key}" to it.endUtc }
        return all(occs).filter { it.at.isAfter(lastCheck) && !it.at.isAfter(now) }.filter { t ->
            val end = ends["${t.eventId}|${t.key}"] ?: t.startUtc
            val over = if (end.isAfter(t.startUtc)) end else t.startUtc
            now.isBefore(over)
        }
    }
}

sealed interface ReminderStatus {
    data object NotificationsOff : ReminderStatus
    data object ExactAlarmsOff : ReminderStatus
    data object BatteryRestricted : ReminderStatus
    data object NoneScheduled : ReminderStatus
    data class Ok(val next: Instant) : ReminderStatus
}

/** What the Settings "Reminders" line says: the most important thing that stops a reminder, then what is next. */
fun reminderStatus(notificationsAllowed: Boolean, canExactAlarm: Boolean, batteryRestricted: Boolean, next: Instant?): ReminderStatus = when {
    !notificationsAllowed -> ReminderStatus.NotificationsOff
    !canExactAlarm -> ReminderStatus.ExactAlarmsOff
    batteryRestricted -> ReminderStatus.BatteryRestricted
    next == null -> ReminderStatus.NoneScheduled
    else -> ReminderStatus.Ok(next)
}

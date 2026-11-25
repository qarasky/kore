package dev.qarasky.korecalendar.edit

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.NetworkException

/** Reminder offsets: the presets, wording and the bounds the API enforces (0–28 days, at most 20). */
const val MAX_REMINDER_MINUTES = 40320
const val MAX_REMINDERS = 20

enum class ReminderUnit(val minutes: Int) { Minutes(1), Hours(60), Days(1440), Weeks(10080) }

/** The quick choices, shortest lead first. */
val ReminderPresets: List<Int> = listOf(0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080)

private fun amount(n: Int, unit: String, msg: Messages) = msg.get("unit_${unit}_${if (n == 1) "one" else "other"}", n)

/** "30 minutes before", "1 hour 30 minutes before", "At time of event". */
fun describeReminder(minutes: Int, allDay: Boolean, msg: Messages): String {
    if (minutes == 0) return msg.get(if (allDay) "reminder_at_midnight" else "reminder_at_start")
    val text = when {
        minutes % 10080 == 0 -> amount(minutes / 10080, "week", msg)
        minutes % 1440 == 0 -> amount(minutes / 1440, "day", msg)
        minutes >= 60 -> {
            val h = minutes / 60
            val m = minutes % 60
            if (m == 0) amount(h, "hour", msg) else "${amount(h, "hour", msg)} ${amount(m, "minute", msg)}"
        }
        else -> amount(minutes, "minute", msg)
    }
    return msg.get(if (allDay) "reminder_before_midnight" else "reminder_before", text)
}

/** A custom amount in minutes, or null if it is not a whole number in range. */
fun toMinutes(value: Double, unit: ReminderUnit): Int? {
    val minutes = value * unit.minutes
    return if (minutes % 1.0 == 0.0 && minutes >= 0 && minutes <= MAX_REMINDER_MINUTES) minutes.toInt() else null
}

/** Adds an offset: no duplicates, longest lead first, at most 20. */
fun addReminder(list: List<Int>, minutes: Int): List<Int> =
    if (minutes in list || list.size >= MAX_REMINDERS) list else (list + minutes).sortedDescending()

/** A person-readable message for anything thrown by an API call. */
fun errorMessage(e: Throwable, msg: Messages): String = msg.get(
    when (e) {
        is NetworkException -> "edit_err_unreachable"
        is ApiException -> when (e.code) {
            "validation_error" -> "edit_err_validation"
            "unsupported_rrule" -> "edit_err_unsupported_rrule"
            "invalid_json" -> "edit_err_invalid_json"
            "unauthorized" -> "edit_err_unauthorized"
            "forbidden" -> "edit_err_forbidden"
            "not_found" -> "edit_err_not_found"
            "rate_limited" -> "edit_err_rate_limited"
            "version_conflict" -> "edit_err_version_conflict"
            "idempotency_conflict" -> "edit_err_idempotency"
            "range_too_large" -> "edit_err_range"
            "busy" -> "edit_err_busy"
            "internal" -> "edit_err_internal"
            else -> "edit_err_generic"
        }
        else -> "edit_err_generic"
    },
)

package dev.qarasky.korecalendar.reminders

import android.Manifest
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.app.Notification
import dev.qarasky.korecalendar.Graph
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.timeLabel
import dev.qarasky.korecalendar.edit.describeReminder
import dev.qarasky.korecalendar.ui.ResourceMessages
import dev.qarasky.korecalendar.widget.eventIntent
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val CHANNEL = "reminders"
private const val ALARM_REQUEST = 4711

/**
 * Reminders as phone alarms, from the local copy, with no push service: the next reminder is set as an exact alarm; when it goes off (or the
 * phone restarts, the clock changes, the app is updated, or a sync brought news) everything that came due is shown and the next alarm is set.
 */
class ReminderRunner(private val context: Context, private val graph: Graph) {
    private val engine = ReminderEngine()
    private val alarms = context.getSystemService(AlarmManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)

    private fun lastCheck(): Instant? = graph.kv.get(LAST_CHECK)?.let { runCatching { Instant.parse(it) }.getOrNull() }

    private fun alarmIntent(): PendingIntent =
        PendingIntent.getBroadcast(context, ALARM_REQUEST, Intent(context, RemindersReceiver::class.java).setAction(ACTION_ALARM), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** The permission, the app-wide switch and the Reminders channel itself (long-press "turn off" on one reminder mutes only that) must all be on. */
    fun notificationsAllowed(): Boolean {
        ensureChannel()
        return context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
            notifications.areNotificationsEnabled() &&
            notifications.getNotificationChannel(CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun canExact(): Boolean = alarms.canScheduleExactAlarms()

    private fun batteryRestricted(): Boolean = context.getSystemService(ActivityManager::class.java).isBackgroundRestricted

    private val lock = Mutex()

    suspend fun sync(now: Instant) = sync { now }

    /**
     * Shows what came due since the last check, then sets the next alarm. Signed out: no alarms and no notifications at all.
     * One at a time (the alarm, a sync and the app can all ask at once), and the next alarm is set even if showing one failed.
     */
    suspend fun sync(clock: () -> Instant = { Instant.now() }) = lock.withLock {
        val now = clock()
        val timezone = graph.accounts.timezone()
        if (timezone == null) {
            alarms.cancel(alarmIntent())
            notifications.cancelAll() // the previous account's titles must not stay in the shade
            graph.kv.put(LAST_CHECK, null)
            return@withLock
        }
        var occs: List<dev.qarasky.korecalendar.data.Occurrence> = emptyList()
        try {
            occs = graph.store.snapshot().occurrences // every calendar: hidden is not muted
            val last = lastCheck()
            if (last != null) {
                val zone = runCatching { ZoneId.of(timezone) }.getOrDefault(ZoneId.of("UTC"))
                engine.due(occs, last, now).forEach { t -> runCatching { show(t, zone) } }
            }
            graph.kv.put(LAST_CHECK, now.toString())
        } finally {
            val next = runCatching { engine.next(occs, now) }.getOrNull()
            if (next == null) {
                alarms.cancel(alarmIntent())
            } else if (canExact()) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at.toEpochMilli(), alarmIntent())
            } else {
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at.toEpochMilli(), alarmIntent()) // late, but not never; Settings says what to fix
            }
        }
    }

    suspend fun status(now: Instant = Instant.now()): ReminderStatus {
        val occs = graph.store.snapshot().occurrences
        return reminderStatus(notificationsAllowed(), canExact(), batteryRestricted(), engine.next(occs, now)?.at)
    }

    private fun ensureChannel() {
        if (notifications.getNotificationChannel(CHANNEL) != null) return
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.reminders_channel_description)
            },
        )
    }

    private fun show(t: ReminderTrigger, zone: ZoneId) {
        if (!notificationsAllowed()) return
        ensureChannel()
        val msg = ResourceMessages(context)
        val clock24 = graph.prefs.clock24
        val time = if (t.allDay) context.getString(R.string.all_day) else timeLabel(t.startUtc.atZone(zone).toLocalTime(), clock24)
        val text = if (t.location.isBlank()) time else "$time · ${t.location}"
        val open = PendingIntent.getActivity(context, t.id.hashCode(), eventIntent(context, t.eventId, t.key), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(Icon.createWithResource(context, R.drawable.ic_launcher_monochrome))
            .setContentTitle(t.title.ifBlank { context.getString(R.string.no_title) })
            .setContentText(text)
            .setSubText(describeReminder(t.minutesBefore, t.allDay, msg))
            .setCategory(Notification.CATEGORY_EVENT)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setWhen(t.startUtc.toEpochMilli())
            .setShowWhen(true)
            .build()
        notifications.notify(t.id.hashCode(), n)
    }

    companion object {
        const val ACTION_ALARM = "dev.qarasky.korecalendar.REMINDER_ALARM"
        private const val LAST_CHECK = "reminders.lastcheck"
    }
}

/** The alarm, and everything that can change the clock or restart the app: show what came due and set the next alarm. */
class RemindersReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                Graph.get(context).reminders.sync()
            } catch (e: Exception) {
                // never take the process down from a broadcast: the next sync, boot or alarm tries again
            } finally {
                pending.finish()
            }
        }
    }
}

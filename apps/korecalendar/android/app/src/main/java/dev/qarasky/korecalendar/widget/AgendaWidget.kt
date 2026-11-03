package dev.qarasky.korecalendar.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import dev.qarasky.korecalendar.Graph
import dev.qarasky.korecalendar.MainActivity
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.Labels
import dev.qarasky.korecalendar.agenda.WidgetModel
import dev.qarasky.korecalendar.agenda.dayLabel
import dev.qarasky.korecalendar.agenda.timeText
import dev.qarasky.korecalendar.agenda.widgetModel
import dev.qarasky.korecalendar.data.Snapshot
import dev.qarasky.korecalendar.ui.parseHex
import dev.qarasky.korecalendar.ui.theme.Palette
import java.time.DateTimeException
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** What the widget draws from: only the phone's own copy, never the network. */
internal data class WidgetData(
    val snapshot: Snapshot?,
    val signedIn: Boolean,
    val zone: ZoneId,
    val hidden: Set<String>,
    val clock24: Boolean,
)

internal suspend fun loadWidgetData(context: Context): WidgetData {
    val g = Graph.get(context)
    val account = g.accounts.load()
    val zone = try {
        ZoneId.of(account?.timezone ?: "UTC")
    } catch (_: DateTimeException) {
        ZoneId.of("UTC")
    }
    return WidgetData(
        snapshot = if (account != null) g.store.snapshot() else null,
        signedIn = account != null && !g.accounts.isRevoked(),
        zone = zone,
        hidden = g.prefs.hiddenCalendars,
        clock24 = g.prefs.clock24,
    )
}

const val EXTRA_EVENT_ID = "event_id"
const val EXTRA_OCC_KEY = "occ_key"

/** Opens the app on one event. The data URI makes each row's intent distinct, so their PendingIntents do not overwrite each other. */
private fun eventIntent(context: Context, eventId: String, key: String): Intent =
    Intent(context, MainActivity::class.java)
        .setData(Uri.parse("korecal://event/" + Uri.encode(eventId) + "/" + Uri.encode(key)))
        .putExtra(EXTRA_EVENT_ID, eventId)
        .putExtra(EXTRA_OCC_KEY, key)

class AgendaWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val data = loadWidgetData(context)
        provideContent { Content(data) }
    }

    @Composable
    private fun Content(data: WidgetData) {
        val context = LocalContext.current
        val heightDp = LocalSize.current.height.value
        val now = Instant.now()
        val snap = data.snapshot
        val model: WidgetModel? = if (snap != null) {
            widgetModel(snap.occurrences, snap.calendars, data.hidden, data.zone, now, snap.lastSyncAt, rowsFor(heightDp))
        } else {
            null
        }
        val footer = when {
            model == null -> null
            model.neverSynced -> context.getString(R.string.never_synced)
            model.staleHours != null -> context.getString(R.string.updated_hours_ago, model.staleHours.toInt())
            else -> null
        }
        val labels = Labels(context.getString(R.string.today), context.getString(R.string.tomorrow))
        val allDay = context.getString(R.string.all_day)
        val until = context.getString(R.string.until)
        val today = now.atZone(data.zone).toLocalDate()

        Column(
            modifier = GlanceModifier.fillMaxSize().background(ColorProvider(Palette.surface)).cornerRadius(20.dp).padding(12.dp)
                .clickable(actionStartActivity(Intent(context, MainActivity::class.java))),
        ) {
            when {
                !data.signedIn -> Text(context.getString(R.string.widget_sign_in), style = style(Palette.muted))
                model == null || model.empty -> Text(context.getString(R.string.widget_empty), style = style(Palette.muted))
                else -> {
                    for (day in fitRows(model.days, heightDp, footer != null)) {
                        Text(
                            dayLabel(day.date, today, labels),
                            style = TextStyle(color = ColorProvider(if (day.date == today) Palette.accent else Palette.muted), fontSize = 11.sp, fontWeight = FontWeight.Bold),
                        )
                        for (item in day.items) {
                            Row(
                                modifier = GlanceModifier.fillMaxWidth().padding(vertical = 1.dp).clickable(
                                    actionStartActivity(eventIntent(context, item.occ.eventId, item.occ.key)),
                                ),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(modifier = GlanceModifier.size(8.dp).cornerRadius(4.dp).background(ColorProvider(parseHex(item.colorHex, Palette.accent)))) {}
                                Spacer(GlanceModifier.width(8.dp))
                                Text(timeText(item, day.date, data.clock24, allDay, until), style = style(Palette.muted), maxLines = 1, modifier = GlanceModifier.width(92.dp))
                                Text(item.occ.title.ifBlank { context.getString(R.string.no_title) }, style = style(Palette.text), maxLines = 1)
                            }
                        }
                    }
                    if (footer != null) Text(footer, style = TextStyle(color = ColorProvider(Palette.muted), fontSize = 10.sp))
                }
            }
        }
    }

    private fun style(color: Color) = TextStyle(color = ColorProvider(color), fontSize = 12.sp)
}

class AgendaWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AgendaWidget()
}

object WidgetUpdater {
    /** Redraws every Agenda widget and arms the alarm for when its first listed event ends. */
    suspend fun updateAll(context: Context) {
        AgendaWidget().updateAll(context)
        scheduleTick(context)
    }

    private suspend fun scheduleTick(context: Context) {
        val data = loadWidgetData(context)
        val snap = data.snapshot
        val tickAt = if (snap != null && data.signedIn) {
            widgetModel(snap.occurrences, snap.calendars, data.hidden, data.zone, Instant.now(), snap.lastSyncAt, 1).nextTick
        } else {
            null
        }
        val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pending = PendingIntent.getBroadcast(
            context, 0, Intent(context, WidgetTickReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        if (tickAt == null) alarms.cancel(pending) else alarms.set(AlarmManager.RTC, tickAt.toEpochMilli() + 1_000, pending)
    }
}

/** Fired when the event at the top of the widget has ended: redraw so it leaves the list. */
class WidgetTickReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                WidgetUpdater.updateAll(context.applicationContext)
            } finally {
                pending.finish()
            }
        }
    }
}

package dev.qarasky.korecalendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import dev.qarasky.korecalendar.BuildConfig
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.ui.theme.Palette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: AppState.Ready,
    onBack: () -> Unit,
    onClock24: (Boolean) -> Unit,
    onToggleCalendar: (String) -> Unit,
    onWeekStart: (dev.qarasky.korecalendar.views.WeekStart) -> Unit,
    controller: AppController,
    onSignOut: () -> Unit,
) {
    BackHandler(onBack = onBack)
    var confirm by remember { mutableStateOf(false) }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current

    Scaffold(
        containerColor = Palette.bg,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.bg, titleContentColor = Palette.text),
                navigationIcon = { TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.back)) } },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Heading(stringResource(R.string.server))
            Text(state.server)
            if (state.cleartext) Text(stringResource(R.string.cleartext_warning), color = Palette.warning, style = MaterialTheme.typography.bodySmall)
            Heading(stringResource(R.string.account))
            Text(state.email)
            Text(stringResource(R.string.time_zone_note, state.zone.id), color = Palette.muted, style = MaterialTheme.typography.bodySmall)

            Heading(stringResource(R.string.clock))
            ClockChoice(stringResource(R.string.clock_24), state.clock24) { onClock24(true) }
            ClockChoice(stringResource(R.string.clock_12), !state.clock24) { onClock24(false) }

            Heading(stringResource(R.string.week_starts_on))
            ClockChoice(stringResource(R.string.week_start_mon), state.weekStart == dev.qarasky.korecalendar.views.WeekStart.Mon) { onWeekStart(dev.qarasky.korecalendar.views.WeekStart.Mon) }
            ClockChoice(stringResource(R.string.week_start_sun), state.weekStart == dev.qarasky.korecalendar.views.WeekStart.Sun) { onWeekStart(dev.qarasky.korecalendar.views.WeekStart.Sun) }
            ClockChoice(stringResource(R.string.week_start_sat), state.weekStart == dev.qarasky.korecalendar.views.WeekStart.Sat) { onWeekStart(dev.qarasky.korecalendar.views.WeekStart.Sat) }

            Heading(stringResource(R.string.calendars))
            Text(stringResource(R.string.calendars_hint), color = Palette.muted, style = MaterialTheme.typography.bodySmall)
            for (c in state.calendars) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = !c.hidden, role = Role.Switch, onValueChange = { onToggleCalendar(c.calendar.id) }),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CalendarDot(parseHex(c.calendar.color, Palette.accent))
                    Text(c.calendar.name, Modifier.weight(1f).padding(start = 12.dp))
                    Switch(checked = !c.hidden, onCheckedChange = null)
                }
            }

            Heading(stringResource(R.string.reminders))
            RemindersSection(state, controller)

            Heading(stringResource(R.string.update_check))
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = state.updateCheck, role = Role.Switch, onValueChange = { v -> scope.launch { controller.setUpdateCheck(v) } }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.update_check), Modifier.weight(1f))
                Switch(checked = state.updateCheck, onCheckedChange = null)
            }
            Text(stringResource(R.string.update_check_hint), color = Palette.muted, style = MaterialTheme.typography.bodySmall)
            state.update?.let { u ->
                Text(stringResource(R.string.update_available, u.version), color = Palette.accent)
                val downloadDescription = stringResource(R.string.update_download_description, u.version)
                TextButton(onClick = { openSafely(context, android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(u.url))) }, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = downloadDescription }) {
                    Text(stringResource(R.string.update_download))
                }
            }

            HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Palette.border)
            TextButton(onClick = { confirm = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.sign_out), color = Palette.danger) }
            Text(stringResource(R.string.version, BuildConfig.VERSION_NAME), color = Palette.muted, style = MaterialTheme.typography.bodySmall)
        }
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text(stringResource(R.string.sign_out_title)) },
            text = { Text(stringResource(R.string.sign_out_body)) },
            confirmButton = { TextButton(onClick = { confirm = false; onSignOut() }) { Text(stringResource(R.string.sign_out), color = Palette.danger) } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, color = Palette.muted, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 12.dp))
}

@Composable
private fun ClockChoice(label: String, selected: Boolean, onSelect: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = selected, role = Role.RadioButton, onClick = onSelect), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected = selected, onClick = null)
        Text(label, Modifier.padding(start = 12.dp))
    }
}

/** What the reminders are doing, and the fix when something stops them: a reminder that silently does not fire is the failure to avoid. */
@Composable
private fun RemindersSection(state: AppState.Ready, controller: AppController) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var resumed by remember { mutableStateOf(0) }
    // Coming back from the system's settings re-reads the state.
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        resumed++
        onPauseOrDispose {}
    }
    val status by androidx.compose.runtime.produceState<dev.qarasky.korecalendar.reminders.ReminderStatus?>(null, resumed, state.revision) {
        // Re-read while the screen is open: an alarm that fires meanwhile moves "next" on.
        while (true) {
            value = controller.reminderStatus()
            kotlinx.coroutines.delay(20_000)
        }
    }
    val s = status
    val (text, fix) = when (s) {
        null -> "" to null
        dev.qarasky.korecalendar.reminders.ReminderStatus.NotificationsOff -> stringResource(R.string.reminders_notifications_off) to android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
        dev.qarasky.korecalendar.reminders.ReminderStatus.ExactAlarmsOff -> stringResource(R.string.reminders_exact_off) to android.content.Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, android.net.Uri.parse("package:" + context.packageName))
        dev.qarasky.korecalendar.reminders.ReminderStatus.BatteryRestricted -> stringResource(R.string.reminders_battery) to android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName))
        dev.qarasky.korecalendar.reminders.ReminderStatus.NoneScheduled -> stringResource(R.string.reminders_none) to null
        is dev.qarasky.korecalendar.reminders.ReminderStatus.Ok -> {
            val at = s.next.atZone(state.zone)
            stringResource(R.string.reminders_ok, dev.qarasky.korecalendar.edit.dateText(at.toLocalDate()) + " " + dev.qarasky.korecalendar.agenda.timeLabel(at.toLocalTime(), state.clock24)) to null
        }
    }
    val problem = s is dev.qarasky.korecalendar.reminders.ReminderStatus.NotificationsOff || s is dev.qarasky.korecalendar.reminders.ReminderStatus.ExactAlarmsOff || s is dev.qarasky.korecalendar.reminders.ReminderStatus.BatteryRestricted
    if (text.isNotEmpty()) Text(text, color = if (problem) Palette.warning else Palette.text)
    val fixDescription = stringResource(R.string.reminders_fix_description)
    if (fix != null) TextButton(onClick = { openSafely(context, fix) }, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = fixDescription }) { Text(stringResource(R.string.reminders_fix)) }
    Text(stringResource(R.string.reminders_hint), color = Palette.muted, style = MaterialTheme.typography.bodySmall)
}

/** Opens a system screen or a browser; a phone without the target (no browser, a vendor that removed a settings page) must not crash the app. */
private fun openSafely(context: android.content.Context, intent: android.content.Intent) {
    try {
        context.startActivity(intent)
    } catch (_: android.content.ActivityNotFoundException) {
        android.widget.Toast.makeText(context, context.getString(R.string.cannot_open), android.widget.Toast.LENGTH_SHORT).show()
    }
}

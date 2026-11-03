package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.edit.End
import dev.qarasky.korecalendar.edit.Freq
import dev.qarasky.korecalendar.edit.Messages
import dev.qarasky.korecalendar.edit.MonthlyMode
import dev.qarasky.korecalendar.edit.Recurrence
import dev.qarasky.korecalendar.edit.ReminderPresets
import dev.qarasky.korecalendar.edit.ReminderUnit
import dev.qarasky.korecalendar.edit.RuleContext
import dev.qarasky.korecalendar.edit.Scope
import dev.qarasky.korecalendar.edit.describeReminder
import dev.qarasky.korecalendar.edit.describeRule
import dev.qarasky.korecalendar.edit.buildRule
import dev.qarasky.korecalendar.edit.matchPreset
import dev.qarasky.korecalendar.edit.presets
import dev.qarasky.korecalendar.edit.toMinutes
import dev.qarasky.korecalendar.edit.weekday
import dev.qarasky.korecalendar.edit.weekdayShort
import dev.qarasky.korecalendar.ui.theme.Palette
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

/** A list of radio choices in a dialog: picking one closes it. */
@Composable
fun <T> ChoiceDialog(title: String, options: List<Pair<T, String>>, selected: T?, onPick: (T) -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                for ((value, label) in options) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = value == selected, role = Role.RadioButton, onClick = { onPick(value); onDismiss() }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = value == selected, onClick = null)
                        Text(label, Modifier.padding(start = 12.dp))
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

/** Which events a repeating-event edit or delete applies to. */
@Composable
fun ScopeDialog(delete: Boolean, allowed: List<Scope>, onPick: (Scope) -> Unit, onDismiss: () -> Unit) {
    // The narrowest change is the default, as on the web: a tap on Save must not change the whole series.
    var choice by remember { mutableStateOf(allowed.first()) }
    val label = mapOf(Scope.This to R.string.scope_this, Scope.Following to R.string.scope_following, Scope.All to R.string.scope_all)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (delete) R.string.scope_delete_title else R.string.scope_edit_title)) },
        text = {
            Column {
                for (s in allowed) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = s == choice, role = Role.RadioButton, onClick = { choice = s }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = s == choice, onClick = null)
                        Text(stringResource(label.getValue(s)), Modifier.padding(start = 12.dp))
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onPick(choice) }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(if (delete) R.string.scope_confirm_delete else R.string.scope_confirm_edit), color = if (delete) Palette.danger else Palette.accent)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun ConfirmDeleteDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.delete_title)) },
        text = { Text(stringResource(R.string.delete_body, title)) },
        confirmButton = { TextButton(onClick = onConfirm, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.delete), color = Palette.danger) } },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateDialog(initial: LocalDate, onPick: (LocalDate) -> Unit, onDismiss: () -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) }
                onDismiss()
            }) { Text(stringResource(R.string.ok)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    ) { DatePicker(state) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeDialog(initial: LocalTime, clock24: Boolean, onPick: (LocalTime) -> Unit, onDismiss: () -> Unit) {
    val state = rememberTimePickerState(initial.hour, initial.minute, is24Hour = clock24)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.pick_time)) },
        text = { TimePicker(state) },
        confirmButton = { TextButton(onClick = { onPick(LocalTime.of(state.hour, state.minute)); onDismiss() }) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
fun TimezoneDialog(current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val all = remember { (ZoneId.getAvailableZoneIds().filter { '/' in it && !it.startsWith("Etc/") && !it.startsWith("SystemV/") } + "UTC").sorted() }
    val shown = remember(query) { all.filter { query.isBlank() || it.contains(query.trim(), ignoreCase = true) || it.replace('_', ' ').contains(query.trim(), ignoreCase = true) } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.editor_timezone)) },
        text = {
            Column {
                OutlinedTextField(
                    value = query, onValueChange = { query = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    label = { Text(stringResource(R.string.timezone_search)) },
                )
                if (shown.isEmpty()) Text(stringResource(R.string.timezone_none), color = Palette.muted, modifier = Modifier.padding(top = 12.dp))
                LazyColumn(Modifier.heightIn(max = 360.dp)) {
                    items(shown, key = { it }) { id ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = id == current, role = Role.RadioButton, onClick = { onPick(id); onDismiss() }),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = id == current, onClick = null)
                            Text(id.replace('_', ' '), Modifier.padding(start = 12.dp))
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

/** The repeat choices for an event starting on [start]: the presets, "Custom…", and a rule the editor cannot express is shown and kept. */
@Composable
fun RepeatDialog(current: Recurrence, start: LocalDate, ctx: RuleContext, msg: Messages, onPick: (Recurrence) -> Unit, onDismiss: () -> Unit) {
    var custom by remember { mutableStateOf(false) }
    if (custom) {
        CustomRepeatDialog(
            initial = current as? Recurrence.Rule ?: Recurrence.Rule(Freq.WEEKLY, 1, listOf(weekday(start)), MonthlyMode.DayOfMonth, End.Never),
            start = start, ctx = ctx, msg = msg, onPick = onPick, onDismiss = onDismiss,
        )
        return
    }
    val list = presets(start, msg)
    val selected = matchPreset(current, start, msg)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.editor_repeat)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (current is Recurrence.Raw) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = true, role = Role.RadioButton, onClick = { onDismiss() }), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = true, onClick = null)
                        Text(describeRule(current.rrule, start, ctx, msg), Modifier.padding(start = 12.dp))
                    }
                    Text(stringResource(R.string.repeat_raw_note), color = Palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 8.dp))
                }
                for (p in list) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = p.id == selected, role = Role.RadioButton, onClick = { onPick(p.recurrence); onDismiss() }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = p.id == selected, onClick = null)
                        Text(p.label, Modifier.padding(start = 12.dp))
                    }
                }
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = selected == null && current is Recurrence.Rule, role = Role.RadioButton, onClick = { custom = true }),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = selected == null && current is Recurrence.Rule, onClick = null)
                    Text(stringResource(R.string.repeat_custom), Modifier.padding(start = 12.dp))
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun CustomRepeatDialog(initial: Recurrence.Rule, start: LocalDate, ctx: RuleContext, msg: Messages, onPick: (Recurrence) -> Unit, onDismiss: () -> Unit) {
    var interval by remember { mutableStateOf(initial.interval.toString()) }
    var freq by remember { mutableStateOf(initial.freq) }
    var days by remember { mutableStateOf(initial.byDay.ifEmpty { listOf(weekday(start)) }.toSet()) }
    var monthly by remember { mutableStateOf(initial.monthly) }
    var endType by remember { mutableStateOf(when (initial.end) { End.Never -> 0; is End.Until -> 1; is End.Count -> 2 }) }
    var until by remember { mutableStateOf((initial.end as? End.Until)?.date ?: start.plusMonths(1)) }
    var count by remember { mutableStateOf(((initial.end as? End.Count)?.count ?: 10).toString()) }
    var pickUntil by remember { mutableStateOf(false) }

    val rule: Recurrence.Rule? = run {
        val n = interval.toIntOrNull()?.takeIf { it >= 1 } ?: return@run null
        val end = when (endType) {
            0 -> End.Never
            1 -> End.Until(until)
            else -> End.Count(count.toIntOrNull()?.takeIf { it >= 1 } ?: return@run null)
        }
        if (freq == Freq.WEEKLY && days.isEmpty()) return@run null
        val candidate = Recurrence.Rule(freq, n, if (freq == Freq.WEEKLY) days.sorted() else emptyList(), if (freq == Freq.MONTHLY) monthly else MonthlyMode.DayOfMonth, end)
        candidate.takeIf { runCatching { buildRule(it, start, ctx) }.isSuccess }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.repeat_custom)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = interval, onValueChange = { interval = it.filter(Char::isDigit).take(3) }, singleLine = true, modifier = Modifier.weight(0.4f),
                        label = { Text(stringResource(R.string.repeat_every)) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((f, label) in listOf(Freq.DAILY to R.string.repeat_unit_day, Freq.WEEKLY to R.string.repeat_unit_week, Freq.MONTHLY to R.string.repeat_unit_month, Freq.YEARLY to R.string.repeat_unit_year)) {
                        FilterChip(selected = freq == f, onClick = { freq = f }, label = { Text(stringResource(label)) }, modifier = Modifier.heightIn(min = 48.dp))
                    }
                }
                if (freq == Freq.WEEKLY) {
                    Text(stringResource(R.string.repeat_on_days), color = Palette.muted, style = MaterialTheme.typography.labelMedium)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (d in listOf(1, 2, 3, 4, 5, 6, 0)) {
                            FilterChip(
                                selected = d in days, onClick = { days = if (d in days) days - d else days + d },
                                label = { Text(weekdayShort(d)) }, modifier = Modifier.heightIn(min = 48.dp),
                            )
                        }
                    }
                }
                if (freq == Freq.MONTHLY) {
                    Text(stringResource(R.string.repeat_monthly_on), color = Palette.muted, style = MaterialTheme.typography.labelMedium)
                    val list = presets(start, msg)
                    for ((mode, id) in listOf(MonthlyMode.DayOfMonth to "monthly-day", MonthlyMode.NthWeekday to "monthly-nth")) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = monthly == mode, role = Role.RadioButton, onClick = { monthly = mode }), verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = monthly == mode, onClick = null)
                            Text(list.first { it.id == id }.label, Modifier.padding(start = 12.dp))
                        }
                    }
                }
                Text(stringResource(R.string.repeat_ends), color = Palette.muted, style = MaterialTheme.typography.labelMedium)
                for ((i, label) in listOf(0 to R.string.repeat_ends_never, 1 to R.string.repeat_ends_on, 2 to R.string.repeat_ends_after)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = endType == i, role = Role.RadioButton, onClick = { endType = i }), verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(selected = endType == i, onClick = null)
                        Text(stringResource(label), Modifier.padding(start = 12.dp))
                    }
                }
                if (endType == 1) TextButton(onClick = { pickUntil = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text(dev.qarasky.korecalendar.edit.dateText(until)) }
                if (endType == 2) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = count, onValueChange = { count = it.filter(Char::isDigit).take(4) }, singleLine = true, modifier = Modifier.weight(0.4f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        Text(stringResource(R.string.repeat_times_label))
                    }
                }
            }
        },
        confirmButton = { TextButton(enabled = rule != null, onClick = { rule?.let(onPick); onDismiss() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.done)) } },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
    if (pickUntil) DateDialog(until, { until = it }, { pickUntil = false })
}

/** Add a reminder: the usual lead times, or a custom amount. */
@Composable
fun ReminderDialog(existing: List<Int>, allDay: Boolean, msg: Messages, onPick: (Int) -> Unit, onDismiss: () -> Unit) {
    var custom by remember { mutableStateOf(false) }
    var amount by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf(ReminderUnit.Minutes) }
    val minutes = amount.toDoubleOrNull()?.let { toMinutes(it, unit) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.editor_add_reminder)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (!custom) {
                    for (m in ReminderPresets.filter { it !in existing }) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onPick(m); onDismiss() }.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(describeReminder(m, allDay, msg))
                        }
                    }
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { custom = true }.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(stringResource(R.string.reminder_custom), color = Palette.accent)
                    }
                } else {
                    OutlinedTextField(
                        value = amount, onValueChange = { amount = it.filter { c -> c.isDigit() || c == '.' }.take(6) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                        label = { Text(stringResource(R.string.reminder_amount)) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        isError = amount.isNotEmpty() && minutes == null,
                        supportingText = if (amount.isNotEmpty() && minutes == null) ({ Text(stringResource(R.string.reminder_too_long)) }) else null,
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        for ((u, label) in listOf(ReminderUnit.Minutes to R.string.reminder_unit_minutes, ReminderUnit.Hours to R.string.reminder_unit_hours, ReminderUnit.Days to R.string.reminder_unit_days, ReminderUnit.Weeks to R.string.reminder_unit_weeks)) {
                            FilterChip(selected = unit == u, onClick = { unit = u }, label = { Text(stringResource(label)) }, modifier = Modifier.heightIn(min = 48.dp))
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (custom) TextButton(enabled = minutes != null && minutes !in existing, onClick = { minutes?.let(onPick); onDismiss() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.add)) }
        },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
    )
}

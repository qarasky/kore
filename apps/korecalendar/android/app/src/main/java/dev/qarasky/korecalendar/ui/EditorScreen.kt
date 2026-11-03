package dev.qarasky.korecalendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.timeLabel
import dev.qarasky.korecalendar.edit.EditorState
import dev.qarasky.korecalendar.edit.EventEditor
import dev.qarasky.korecalendar.edit.FormValues
import dev.qarasky.korecalendar.edit.Messages
import dev.qarasky.korecalendar.edit.Recurrence
import dev.qarasky.korecalendar.edit.RuleContext
import dev.qarasky.korecalendar.edit.Scope
import dev.qarasky.korecalendar.edit.SaveResult
import dev.qarasky.korecalendar.edit.dateText
import dev.qarasky.korecalendar.edit.describeReminder
import dev.qarasky.korecalendar.edit.describeRule
import dev.qarasky.korecalendar.edit.addReminder
import dev.qarasky.korecalendar.edit.withStart
import dev.qarasky.korecalendar.edit.zoneOf
import dev.qarasky.korecalendar.ui.theme.Palette
import java.time.LocalDate
import java.time.LocalTime
import kotlinx.coroutines.launch

/** The event editor: every field of the web editor. A failed save keeps the form exactly as typed. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(controller: AppController, editor: EventEditor, ready: AppState.Ready, msg: Messages, onClose: () -> Unit) {
    val state by editor.state.collectAsState()
    val scope = rememberCoroutineScope()
    var confirmClose by remember { mutableStateOf(false) }
    var askScope by remember { mutableStateOf(false) }
    val editing = state as? EditorState.Editing

    fun close() {
        if (editing != null && editor.hasChanges() && !confirmClose) confirmClose = true else onClose()
    }
    BackHandler { close() }

    fun save(sc: Scope) {
        scope.launch { controller.save(sc) }
    }

    Scaffold(
        containerColor = Palette.bg,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (editing?.creating == false) R.string.editor_edit_title else R.string.editor_new_title)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.bg, titleContentColor = Palette.text),
                navigationIcon = { TextButton(onClick = { close() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.cancel)) } },
                actions = {
                    if (editing != null) {
                        TextButton(
                            enabled = !editing.saving,
                            onClick = {
                                if (!editing.creating && editing.recurring && editor.hasChanges() && editor.scopes().size > 1) askScope = true else save(Scope.All)
                            },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(stringResource(if (editing.saving) R.string.editor_saving else R.string.editor_save)) }
                    }
                },
            )
        },
    ) { padding ->
        when (val s = state) {
            EditorState.Closed, EditorState.Loading -> Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Palette.accent)
            }
            is EditorState.LoadFailed -> Column(Modifier.padding(padding).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(s.message, color = Palette.danger)
                TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.editor_close)) }
            }
            is EditorState.Editing -> Form(editor, s, ready, msg, Modifier.padding(padding))
        }
    }

    if (askScope) {
        ScopeDialog(delete = false, allowed = editor.scopes(), onPick = { askScope = false; save(it) }, onDismiss = { askScope = false })
    }
    if (confirmClose) {
        ConfirmDiscardDialog(onDiscard = { confirmClose = false; onClose() }, onDismiss = { confirmClose = false })
    }
}

@Composable
private fun ConfirmDiscardDialog(onDiscard: () -> Unit, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.discard_title)) },
        text = { Text(stringResource(R.string.discard_body)) },
        confirmButton = { TextButton(onClick = onDiscard, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.discard), color = Palette.danger) } },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.keep_editing)) } },
    )
}

private enum class Picker { StartDate, StartTime, EndDate, EndTime, Zone, Calendar, Repeat, Reminder }

@Composable
private fun Form(editor: EventEditor, s: EditorState.Editing, ready: AppState.Ready, msg: Messages, modifier: Modifier) {
    val f = s.form
    var picker by remember { mutableStateOf<Picker?>(null) }
    val calendar = ready.calendars.firstOrNull { it.calendar.id == f.calendarId }
    val ctx = RuleContext(zoneOf(f.tz), f.allDay)
    val scope = rememberCoroutineScope()
    val titleError = s.errors.title?.let { msg.get(it) }
    val endError = s.errors.end?.let { msg.get(it) }

    Column(
        modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        s.banner?.let { banner ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(banner, color = Palette.danger)
                if (s.conflict) {
                    Text(stringResource(R.string.editor_conflict_hint), color = Palette.muted, style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(shape = MaterialTheme.shapes.small, onClick = { scope.launch { editor.reload() } }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.editor_reload)) }
                }
            }
        }
        OutlinedTextField(
            value = f.title, onValueChange = { v -> editor.edit { it.copy(title = v.take(200)) } }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.editor_title)) }, placeholder = { Text(stringResource(R.string.editor_title_placeholder)) },
            isError = titleError != null, supportingText = titleError?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )

        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(value = f.allDay, role = Role.Switch, onValueChange = { v -> editor.edit { it.copy(allDay = v, endDay = if (v) it.endDay else it.startDay.let { d -> if (it.endDay.isBefore(d)) d else it.endDay }) } }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(R.string.editor_all_day), Modifier.weight(1f))
            Switch(checked = f.allDay, onCheckedChange = null)
        }

        DateTimeRow(stringResource(R.string.editor_start), f.startDay, f.startTime, f.allDay, ready.clock24, { picker = Picker.StartDate }, { picker = Picker.StartTime })
        DateTimeRow(stringResource(R.string.editor_end), f.endDay, f.endTime, f.allDay, ready.clock24, { picker = Picker.EndDate }, { picker = Picker.EndTime })
        endError?.let { Text(it, color = Palette.danger, style = MaterialTheme.typography.bodySmall) }

        Section(stringResource(R.string.editor_timezone)) { Choice(f.tz.replace('_', ' ')) { picker = Picker.Zone } }
        Section(stringResource(R.string.editor_calendar)) {
            if (ready.calendars.isEmpty()) {
                Text(stringResource(R.string.editor_no_calendar), color = Palette.warning)
            } else {
                Choice(calendar?.calendar?.name ?: "", leading = { CalendarDot(parseHex(calendar?.calendar?.color, Palette.accent)) }) { picker = Picker.Calendar }
            }
        }
        Section(stringResource(R.string.editor_repeat)) {
            Choice(repeatText(f.recurrence, f, ctx, msg)) { picker = Picker.Repeat }
        }

        Section(stringResource(R.string.editor_reminders)) {
            for (m in f.reminders) {
                val label = describeReminder(m, f.allDay, msg)
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.weight(1f))
                    TextButton(
                        onClick = { editor.edit { it.copy(reminders = it.reminders - m) } },
                        modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = msg.get("editor_remove_reminder", label) },
                    ) { Text("✕", color = Palette.muted) }
                }
            }
            TextButton(onClick = { picker = Picker.Reminder }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.editor_add_reminder)) }
        }

        OutlinedTextField(
            value = f.location, onValueChange = { v -> editor.edit { it.copy(location = v) } }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.editor_location)) },
        )
        OutlinedTextField(
            value = f.notes, onValueChange = { v -> editor.edit { it.copy(notes = v) } }, minLines = 3, modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.editor_notes)) },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        )
        Spacer(Modifier.width(1.dp))
    }

    when (picker) {
        Picker.StartDate -> DateDialog(f.startDay, { d -> editor.edit { it.withStart(d, it.startTime, rebase = s.creating) } }, { picker = null })
        Picker.StartTime -> TimeDialog(f.startTime, ready.clock24, { t -> editor.edit { it.withStart(it.startDay, t, rebase = s.creating) } }, { picker = null })
        Picker.EndDate -> DateDialog(f.endDay, { d -> editor.edit { it.copy(endDay = d) } }, { picker = null })
        Picker.EndTime -> TimeDialog(f.endTime, ready.clock24, { t -> editor.edit { it.copy(endTime = t) } }, { picker = null })
        Picker.Zone -> TimezoneDialog(f.tz, { z -> editor.edit { it.copy(tz = z) } }, { picker = null })
        Picker.Calendar -> ChoiceDialog(
            title = stringResource(R.string.editor_calendar),
            options = ready.calendars.map { it.calendar.id to it.calendar.name },
            selected = f.calendarId, onPick = { id -> editor.edit { it.copy(calendarId = id) } }, onDismiss = { picker = null },
        )
        Picker.Repeat -> RepeatDialog(f.recurrence, f.startDay, ctx, msg, { r -> editor.edit { it.copy(recurrence = r) } }, { picker = null })
        Picker.Reminder -> ReminderDialog(f.reminders, f.allDay, msg, { m -> editor.edit { it.copy(reminders = addReminder(it.reminders, m)) } }, { picker = null })
        null -> Unit
    }
}

private fun repeatText(r: Recurrence, f: FormValues, ctx: RuleContext, msg: Messages): String = when (r) {
    Recurrence.None -> msg.get("rrule_none")
    is Recurrence.Raw -> describeRule(r.rrule, f.startDay, ctx, msg)
    is Recurrence.Rule -> describeRule(dev.qarasky.korecalendar.edit.buildRule(r, f.startDay, ctx), f.startDay, ctx, msg)
}

@Composable
private fun Section(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = Palette.muted, style = MaterialTheme.typography.labelMedium)
        content()
        HorizontalDivider(color = Palette.border)
    }
}

@Composable
private fun Choice(text: String, leading: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            leading?.let { it(); Spacer(Modifier.width(12.dp)) }
            Text(text, color = Palette.text)
        }
    }
}

@Composable
private fun DateTimeRow(label: String, day: LocalDate, time: LocalTime, allDay: Boolean, clock24: Boolean, onDate: () -> Unit, onTime: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, Modifier.width(56.dp), color = Palette.muted)
        OutlinedButton(shape = MaterialTheme.shapes.small, onClick = onDate, modifier = Modifier.weight(1f).heightIn(min = 48.dp).semantics { contentDescription = "$label: ${dateText(day)}" }) { Text(dateText(day)) }
        if (!allDay) OutlinedButton(shape = MaterialTheme.shapes.small, onClick = onTime, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "$label: ${timeLabel(time, clock24)}" }) { Text(timeLabel(time, clock24)) }
    }
}

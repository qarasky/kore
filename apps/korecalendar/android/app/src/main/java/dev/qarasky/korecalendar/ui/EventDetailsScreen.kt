package dev.qarasky.korecalendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.Labels
import dev.qarasky.korecalendar.agenda.dayLabel
import dev.qarasky.korecalendar.agenda.timeText
import dev.qarasky.korecalendar.ui.theme.Palette

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventDetailsScreen(state: AppState.Ready, eventId: String, key: String, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val row = state.agenda.days.flatMap { d -> d.rows.map { d.date to it } }.firstOrNull { (_, r) -> r.item.occ.eventId == eventId && r.item.occ.key == key }
    val labels = Labels(stringResource(R.string.today), stringResource(R.string.tomorrow))
    val calendar = state.calendars.firstOrNull { it.calendar.id == row?.second?.item?.occ?.calendarId }

    Scaffold(
        containerColor = Palette.bg,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.event_details)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.bg, titleContentColor = Palette.text),
                navigationIcon = { TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.back)) } },
            )
        },
    ) { padding ->
        if (row == null) {
            Text(stringResource(R.string.no_title), Modifier.padding(padding).padding(16.dp), color = Palette.muted)
            return@Scaffold
        }
        val (day, r) = row
        val item = r.item
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(item.occ.title.ifBlank { stringResource(R.string.no_title) }, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(
                dayLabel(item.startLocal.toLocalDate(), state.agenda.today, labels) + "  " +
                    timeText(item, item.startLocal.toLocalDate(), state.clock24, stringResource(R.string.all_day), stringResource(R.string.until)),
                color = Palette.text,
            )
            if (item.startLocal.toLocalDate() != day) Text(stringResource(R.string.until) + " " + dayLabel(item.endLocal.toLocalDate(), state.agenda.today, labels), color = Palette.muted)
            if (item.occ.isRecurring) Text(stringResource(R.string.repeats), color = Palette.muted)
            Spacer(Modifier.height(16.dp))
            if (calendar != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CalendarDot(parseHex(calendar.calendar.color, Palette.accent))
                    Spacer(Modifier.width(8.dp))
                    Text(calendar.calendar.name)
                }
            }
            if (item.occ.location.isNotBlank()) Field(stringResource(R.string.location_label), item.occ.location)
            if (item.occ.notes.isNotBlank()) Field(stringResource(R.string.notes_label), item.occ.notes)
        }
    }
}

@Composable
private fun Field(label: String, value: String) {
    Column(Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Text(label, color = Palette.muted, style = MaterialTheme.typography.labelMedium)
        Text(value)
    }
}

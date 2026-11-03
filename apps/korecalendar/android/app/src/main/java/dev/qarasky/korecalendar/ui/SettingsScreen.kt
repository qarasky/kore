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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
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
    onSignOut: () -> Unit,
) {
    BackHandler(onBack = onBack)
    var confirm by remember { mutableStateOf(false) }

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

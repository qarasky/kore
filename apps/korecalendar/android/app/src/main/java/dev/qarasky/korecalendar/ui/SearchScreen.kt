package dev.qarasky.korecalendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.agendaItemOf
import dev.qarasky.korecalendar.agenda.timeText
import dev.qarasky.korecalendar.edit.dateText
import dev.qarasky.korecalendar.ui.theme.Palette
import dev.qarasky.korecalendar.views.SearchResult
import dev.qarasky.korecalendar.views.groupByStartDay
import kotlinx.coroutines.delay

/** Search: titles, notes and places, 90 days back and 300 ahead; offline it searches the phone's copy. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(state: AppState.Ready, controller: AppController, onBack: () -> Unit, onOpen: (eventId: String, key: String) -> Unit) {
    BackHandler(onBack = onBack)
    var q by rememberSaveable { mutableStateOf("") }
    var result by remember { mutableStateOf<SearchResult?>(null) }
    var forQuery by remember { mutableStateOf("") }
    LaunchedEffect(q, state.lastSync) {
        if (q.isBlank()) {
            result = null
            forQuery = ""
            return@LaunchedEffect
        }
        delay(300) // typing: wait for a pause before asking the server
        result = controller.search(q)
        forQuery = q.trim()
    }
    val colors = state.calendars.associate { it.calendar.id to it.calendar.color }
    val allDay = stringResource(R.string.all_day)
    val until = stringResource(R.string.until)

    Scaffold(
        containerColor = Palette.bg,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.search)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.bg, titleContentColor = Palette.text),
                navigationIcon = { TextButton(onClick = onBack, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.back)) } },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            OutlinedTextField(
                value = q, onValueChange = { q = it.take(200) }, singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                label = { Text(stringResource(R.string.search_hint)) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = {}),
            )
            val r = result
            when {
                q.isBlank() -> Text(stringResource(R.string.search_prompt), color = Palette.muted, modifier = Modifier.padding(16.dp))
                r == null -> Text(stringResource(R.string.range_loading), color = Palette.muted, modifier = Modifier.padding(16.dp))
                else -> {
                    Text(
                        stringResource(R.string.search_count, r.occurrences.size, dateText(r.from), dateText(r.to)),
                        color = Palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp),
                    )
                    if (r.offline) Text(stringResource(R.string.search_offline_note), color = Palette.warning, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
                    if (r.occurrences.isEmpty()) {
                        Text(stringResource(R.string.search_none, forQuery), color = Palette.muted, modifier = Modifier.padding(16.dp))
                    } else {
                        val groups = groupByStartDay(r.occurrences, state.zone)
                        LazyColumn(Modifier.fillMaxSize()) {
                            for (g in groups) {
                                item(key = "h-${g.day}") {
                                    Text(dateText(g.day), style = MaterialTheme.typography.titleSmall, color = Palette.muted, modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp))
                                }
                                items(g.items, key = { "${it.eventId}|${it.key}" }) { o ->
                                    val item = agendaItemOf(o, colors[o.calendarId], state.zone)
                                    val title = o.title.ifBlank { stringResource(R.string.no_title) }
                                    val time = timeText(item, g.day, state.clock24, allDay, until)
                                    Row(
                                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable { onOpen(o.eventId, o.key) }.padding(horizontal = 16.dp, vertical = 8.dp)
                                            .semantics(mergeDescendants = true) { contentDescription = "$time, $title" },
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        CalendarDot(parseHex(item.colorHex, Palette.accent))
                                        Spacer(Modifier.width(12.dp))
                                        Text(time, color = Palette.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.width(112.dp))
                                        Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

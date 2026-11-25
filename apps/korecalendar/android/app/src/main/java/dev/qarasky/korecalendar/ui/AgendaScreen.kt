package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.Labels
import dev.qarasky.korecalendar.agenda.dayLabel
import dev.qarasky.korecalendar.agenda.timeText
import dev.qarasky.korecalendar.ui.theme.Palette
import kotlinx.coroutines.launch

/** The Agenda view: days from today on. The scaffold around it belongs to [HomeScreen]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgendaContent(
    state: AppState.Ready,
    listState: androidx.compose.foundation.lazy.LazyListState,
    onRefresh: suspend () -> Unit,
    onOpen: (eventId: String, key: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val agenda = state.agenda
    val labels = Labels(stringResource(R.string.today), stringResource(R.string.tomorrow))
    val allDay = stringResource(R.string.all_day)
    val until = stringResource(R.string.until)
    val scope = rememberCoroutineScope()

    PullToRefreshBox(
        isRefreshing = state.syncState is SyncState.Syncing,
        onRefresh = { scope.launch { onRefresh() } },
        modifier = modifier.fillMaxSize(),
    ) {
        LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 96.dp), modifier = Modifier.fillMaxSize()) {
            item { StatusLine(state) }
            for (day in agenda.days) {
                item(key = "h-${day.date}") {
                    Text(
                        dayLabel(day.date, agenda.today, labels),
                        style = MaterialTheme.typography.titleSmall,
                        color = if (day.date == agenda.today) Palette.accent else Palette.muted,
                        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
                    )
                }
                items(day.rows, key = { "${it.item.occ.eventId}|${it.item.occ.key}|${day.date}" }) { row ->
                    val item = row.item
                    val title = item.occ.title.ifBlank { stringResource(R.string.no_title) }
                    val time = timeText(item, day.date, state.clock24, allDay, until)
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .clickable { onOpen(item.occ.eventId, item.occ.key) }
                            .padding(horizontal = 16.dp, vertical = 8.dp)
                            .alpha(if (row.ended) 0.5f else 1f)
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
            if (agenda.empty) {
                item {
                    Text(
                        stringResource(R.string.nothing_upcoming),
                        color = Palette.muted,
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                    )
                }
            }
        }
    }
}

@Composable
fun StatusLine(state: AppState.Ready) {
    val agenda = state.agenda
    val text: String? = when {
        state.syncState is SyncState.Failed -> stringResource(R.string.sync_failed_note, state.syncState.message)
        agenda.offline -> stringResource(R.string.offline_note)
        agenda.neverSynced -> stringResource(R.string.never_synced)
        agenda.staleHours != null -> stringResource(R.string.updated_hours_ago, agenda.staleHours.toInt())
        state.reminderProblem -> stringResource(R.string.reminders_problem_note)
        state.update != null -> stringResource(R.string.update_available, state.update.version)
        else -> null
    }
    if (text != null) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(text, color = if (agenda.offline || state.syncState is SyncState.Failed || state.reminderProblem) Palette.warning else Palette.muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

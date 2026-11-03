package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.ui.theme.Palette
import dev.qarasky.korecalendar.views.View
import dev.qarasky.korecalendar.views.periodLabel
import kotlinx.coroutines.launch

/** The home of the app: the view switcher and the chosen view (Agenda, Day, Week, Month) with the new-event button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    state: AppState.Ready,
    controller: AppController,
    onOpen: (eventId: String, key: String) -> Unit,
    onSettings: () -> Unit,
    onSearch: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val views = listOf(View.Agenda to R.string.view_agenda, View.Day to R.string.view_day, View.Week to R.string.view_week, View.Month to R.string.view_month)

    Scaffold(
        containerColor = Palette.bg,
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { controller.beginNew(if (state.view == View.Agenda) null else state.day) }, containerColor = Palette.accent, contentColor = Palette.bg) {
                Text(stringResource(R.string.new_event))
            }
        },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_bar_title)) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.bg, titleContentColor = Palette.text),
                actions = {
                    TextButton(
                        onClick = { if (state.view == View.Agenda) scope.launch { listState.animateScrollToItem(0) } else controller.today() },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.today)) }
                    TextButton(onClick = onSearch, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.search)) }
                    TextButton(onClick = onSettings, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.settings)) }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for ((v, label) in views) {
                    FilterChip(
                        selected = state.view == v,
                        onClick = { scope.launch { controller.setView(v) } },
                        label = { Text(stringResource(label)) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    )
                }
            }
            if (state.view != View.Agenda) {
                val label = periodLabel(state.view, state.day, state.weekStart)
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    val prev = stringResource(R.string.previous)
                    val next = stringResource(R.string.next)
                    TextButton(onClick = { controller.step(-1) }, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = prev }) { Text("‹", color = Palette.text) }
                    Text(label, Modifier.weight(1f), color = Palette.text, maxLines = 1, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    TextButton(onClick = { controller.step(1) }, modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = next }) { Text("›", color = Palette.text) }
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (state.view) {
                    View.Agenda -> AgendaContent(state, listState, onRefresh = { controller.refresh() }, onOpen = onOpen)
                    View.Day, View.Week -> TimeGridView(state, controller, onOpen)
                    View.Month -> MonthView(state, controller, onOpen)
                }
            }
        }
    }
}

package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.DAY_NAMES
import dev.qarasky.korecalendar.edit.dateText
import dev.qarasky.korecalendar.ui.theme.Palette
import dev.qarasky.korecalendar.views.View
import dev.qarasky.korecalendar.views.chipsForDay
import dev.qarasky.korecalendar.views.groupByDay
import kotlinx.coroutines.launch

/** The Month view: six weeks of day cells with a few event chips each; a tap on a day opens that day. */
@Composable
fun MonthView(state: AppState.Ready, controller: AppController, onOpen: (eventId: String, key: String) -> Unit) {
    val (range, data) = rememberViewData(state, controller)
    val scope = rememberCoroutineScope()
    val colors = state.calendars.associate { it.calendar.id to parseHex(it.calendar.color, Palette.accent) }
    val groups = remember(data, range.days, state.zone) { groupByDay(data?.occurrences ?: emptyList(), range.days, state.zone).associateBy { it.day } }
    val weeks = range.days.chunked(7)

    Column(Modifier.fillMaxSize()) {
        if (data == null) Text(stringResource(R.string.range_loading), color = Palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
        else if (data.offline) Text(stringResource(R.string.range_offline_note), color = Palette.warning, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
        Row(Modifier.fillMaxWidth()) {
            for (d in weeks.first()) {
                Text(DAY_NAMES[d.dayOfWeek.value - 1], Modifier.weight(1f), textAlign = TextAlign.Center, color = Palette.muted, style = MaterialTheme.typography.labelMedium)
            }
        }
        for (week in weeks) {
            Row(Modifier.weight(1f).fillMaxWidth()) {
                for (d in week) {
                    val items = groups[d]?.items ?: emptyList()
                    val chips = chipsForDay(items, 3)
                    val inMonth = d.month == state.day.month
                    val isToday = d == state.agenda.today
                    val description = stringResource(R.string.day_cell_description, dateText(d), items.size)
                    Column(
                        Modifier.weight(1f).fillMaxHeight()
                            .border(BorderStroke(0.5.dp, Palette.border))
                            .clickable { scope.launch { controller.goTo(d, View.Day) } }
                            .padding(2.dp)
                            .semantics(mergeDescendants = true) { contentDescription = description },
                    ) {
                        Box(
                            Modifier.size(22.dp).then(if (isToday) Modifier.background(Palette.accent, CircleShape) else Modifier).align(Alignment.CenterHorizontally),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text("${d.dayOfMonth}", fontSize = 12.sp, color = if (isToday) Palette.bg else if (inMonth) Palette.text else Palette.muted.copy(alpha = 0.6f))
                        }
                        for (o in chips.shown) {
                            val color = colors[o.calendarId] ?: Palette.accent
                            Text(
                                o.title.ifBlank { stringResource(R.string.no_title) }, maxLines = 1, overflow = TextOverflow.Clip, fontSize = 10.sp, lineHeight = 12.sp,
                                modifier = Modifier.fillMaxWidth().padding(top = 1.dp).background(color.copy(alpha = if (inMonth) 0.35f else 0.18f), RoundedCornerShape(2.dp)).padding(horizontal = 2.dp),
                            )
                        }
                        if (chips.more > 0) Text(stringResource(R.string.more_events, chips.more), fontSize = 10.sp, color = Palette.muted, maxLines = 1)
                    }
                }
            }
        }
    }
}

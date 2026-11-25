package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.agenda.DAY_NAMES
import dev.qarasky.korecalendar.agenda.timeLabel
import dev.qarasky.korecalendar.edit.dateText
import dev.qarasky.korecalendar.ui.theme.Palette
import dev.qarasky.korecalendar.views.hourLabel
import dev.qarasky.korecalendar.views.placeAllDay
import dev.qarasky.korecalendar.views.placeTimed
import dev.qarasky.korecalendar.views.snapToHalfHour
import java.time.Instant
import java.time.LocalTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val HOUR_HEIGHT = 56.dp
private val GUTTER = 44.dp
private val ALL_DAY_LANE = 22.dp

/**
 * The Day and Week views: a wall-clock grid of 24 hour rows in the account's zone, an all-day strip, a line for now,
 * and a tap on an empty slot starts a new event at that half hour. A week is seven columns that scroll sideways when
 * the phone is too narrow to read them.
 */
@Composable
fun TimeGridView(state: AppState.Ready, controller: AppController, onOpen: (eventId: String, key: String) -> Unit) {
    val (range, data) = rememberViewData(state, controller)
    val days = range.days
    val colors = state.calendars.associate { it.calendar.id to parseHex(it.calendar.color, Palette.accent) }
    val today = state.agenda.today
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            nowMillis = System.currentTimeMillis()
        }
    }
    val nowLocal = Instant.ofEpochMilli(nowMillis).atZone(state.zone)
    val nowMinutes = nowLocal.hour * 60 + nowLocal.minute

    val placed = remember(data, days, state.zone) { placeTimed(data?.occurrences ?: emptyList(), days, state.zone) }
    val bars = remember(data, days) { placeAllDay(data?.occurrences ?: emptyList(), days) }
    val laneCount = (bars.maxOfOrNull { it.lane } ?: -1) + 1
    val shownLanes = minOf(laneCount, 3)

    val scope = rememberCoroutineScope()
    val hScroll = rememberScrollState()
    val density = LocalDensity.current
    val startHour = if (today in days) maxOf(0, nowLocal.hour - 1) else 7
    val vScroll = rememberScrollState(with(density) { (HOUR_HEIGHT * startHour).roundToPx() })
    val hourPx = with(density) { HOUR_HEIGHT.toPx() }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val colW = if (days.size == 1) maxWidth - GUTTER else maxOf(96.dp, (maxWidth - GUTTER) / days.size)
        Column(Modifier.fillMaxSize()) {
            if (data == null) Text(stringResource(R.string.range_loading), color = Palette.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))
            else if (data.offline) Text(stringResource(R.string.range_offline_note), color = Palette.warning, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(horizontal = 16.dp))

            // Day headings
            Row {
                Box(Modifier.width(GUTTER))
                Row(Modifier.horizontalScroll(hScroll)) {
                    for (d in days) {
                        val isToday = d == today
                        Column(
                            Modifier.width(colW).padding(vertical = 4.dp)
                                .then(if (days.size > 1) Modifier.clickable { scope.launch { controller.goTo(d, dev.qarasky.korecalendar.views.View.Day) } } else Modifier)
                                .semantics(mergeDescendants = true) { contentDescription = dateText(d) },
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(DAY_NAMES[d.dayOfWeek.value - 1], color = if (isToday) Palette.accent else Palette.muted, style = MaterialTheme.typography.labelMedium)
                            Text("${d.dayOfMonth}", color = if (isToday) Palette.accent else Palette.text, style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
            }

            // All-day strip: three lanes show, more scroll, so every all-day event can be reached
            if (shownLanes > 0) {
                Row {
                    Box(Modifier.width(GUTTER))
                    Box(Modifier.horizontalScroll(hScroll).verticalScroll(rememberScrollState()).width(colW * days.size).height(ALL_DAY_LANE * shownLanes)) {
                        Box(Modifier.width(colW * days.size).height(ALL_DAY_LANE * laneCount)) {
                            for (b in bars) {
                                val color = colors[b.occ.calendarId] ?: Palette.accent
                                Box(
                                    Modifier.offset(colW * b.startIdx + 1.dp, ALL_DAY_LANE * b.lane).size(colW * b.span - 2.dp, ALL_DAY_LANE - 2.dp)
                                        .background(color.copy(alpha = 0.35f), androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                                        .clickable { onOpen(b.occ.eventId, b.occ.key) }
                                        .padding(horizontal = 4.dp),
                                    contentAlignment = Alignment.CenterStart,
                                ) { Text(b.occ.title.ifBlank { stringResource(R.string.no_title) }, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp) }
                            }
                        }
                    }
                }
            }

            // The hour grid
            Row(Modifier.weight(1f).verticalScroll(vScroll)) {
                Column(Modifier.width(GUTTER)) {
                    for (h in 0 until 24) {
                        Box(Modifier.height(HOUR_HEIGHT), contentAlignment = Alignment.TopEnd) {
                            if (h > 0) Text(hourLabel(h, state.clock24), color = Palette.muted, fontSize = 10.sp, modifier = Modifier.padding(end = 4.dp))
                        }
                    }
                }
                Row(Modifier.horizontalScroll(hScroll)) {
                    for (d in days) {
                        val newHere = stringResource(R.string.new_event_here)
                        val slotLabel = stringResource(R.string.grid_slot_description, dateText(d), state.zone.id)
                        Box(
                            Modifier.width(colW).height(HOUR_HEIGHT * 24)
                                .border(androidx.compose.foundation.BorderStroke(0.5.dp, Palette.border))
                                .drawBehind {
                                    for (h in 1 until 24) drawLine(Palette.border, Offset(0f, h * hourPx), Offset(size.width, h * hourPx), strokeWidth = 1f)
                                }
                                .pointerInput(d, state.clock24) {
                                    detectTapGestures { offset ->
                                        val minutes = snapToHalfHour((offset.y / hourPx * 60).toInt())
                                        controller.beginNew(d, LocalTime.of(minutes / 60, minutes % 60))
                                    }
                                }
                                .semantics {
                                    contentDescription = slotLabel
                                    // TalkBack and switch users cannot tap a position: offer the new event as an action.
                                    onClick(label = newHere) { controller.beginNew(d, LocalTime.of(9, 0)); true }
                                },
                        ) {
                            for (p in placed.filter { it.day == d }) {
                                val color = colors[p.occ.calendarId] ?: Palette.accent
                                val w = colW * p.span / p.cols
                                val title = p.occ.title.ifBlank { stringResource(R.string.no_title) }
                                Column(
                                    Modifier.offset(colW * p.col / p.cols + 1.dp, HOUR_HEIGHT * (p.top / 60f)).size(w - 2.dp, HOUR_HEIGHT * (p.height / 60f) - 1.dp)
                                        .background(color.copy(alpha = 0.35f), androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
                                        .clickable { onOpen(p.occ.eventId, p.occ.key) }
                                        .padding(horizontal = 4.dp, vertical = 2.dp)
                                        .semantics(mergeDescendants = true) { contentDescription = "${timeLabel(p.occ.startUtc.atZone(state.zone).toLocalTime(), state.clock24)}, $title" },
                                ) {
                                    Text(title, maxLines = if (p.height >= 45) 2 else 1, overflow = TextOverflow.Ellipsis, fontSize = 12.sp)
                                    if (p.height >= 45) {
                                        val t = p.occ.startUtc.atZone(state.zone).toLocalTime()
                                        Text(timeLabel(t, state.clock24), color = Palette.muted, fontSize = 10.sp, maxLines = 1)
                                    }
                                }
                            }
                            if (d == today) {
                                Box(Modifier.offset(0.dp, HOUR_HEIGHT * (nowMinutes / 60f)).width(colW).height(2.dp).background(Palette.danger))
                            }
                        }
                    }
                }
            }
        }
    }
}

package dev.qarasky.korecalendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.qarasky.korecalendar.views.RangeResult
import dev.qarasky.korecalendar.views.viewRange
import java.time.Instant

/** What a view shows: its days and, once loaded, its occurrences (null while loading). Reloads when the range, the copy or the hidden calendars change. */
@Composable
fun rememberViewData(state: AppState.Ready, controller: AppController): Pair<dev.qarasky.korecalendar.views.ViewRange, RangeResult?> {
    val range = viewRange(state.view, state.day, state.zone, state.weekStart)
    var result by remember { mutableStateOf<RangeResult?>(null) }
    var forKey by remember { mutableStateOf<Any?>(null) }
    val key = listOf(range.from, range.to, state.lastSync, state.calendars.filter { it.hidden }.map { it.calendar.id })
    LaunchedEffect(key) {
        val r = controller.loadRange(range.from, range.to)
        result = r
        forKey = key
    }
    // While the next range loads, the old one must not be drawn on the new days.
    return range to (if (forKey == key) result else null)
}

internal fun Instant?.orEpoch(): Instant = this ?: Instant.EPOCH

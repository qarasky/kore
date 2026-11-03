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

/**
 * What a view shows: its days and, once loaded, its occurrences (null while the first load of that range runs). Reloads when
 * the range, a refresh or the hidden calendars change; while it reloads the same range the old answer stays on screen.
 */
@Composable
fun rememberViewData(state: AppState.Ready, controller: AppController): Pair<dev.qarasky.korecalendar.views.ViewRange, RangeResult?> {
    val range = viewRange(state.view, state.day, state.zone, state.weekStart)
    var result by remember { mutableStateOf<RangeResult?>(null) }
    var resultRange by remember { mutableStateOf<Pair<Instant, Instant>?>(null) }
    val key = listOf(range.from, range.to, state.revision, state.calendars.filter { it.hidden }.map { it.calendar.id })
    LaunchedEffect(key) {
        val r = controller.loadRange(range.from, range.to)
        result = r
        resultRange = range.from to range.to
    }
    // The answer for another range must never be drawn on these days.
    return range to (if (resultRange == (range.from to range.to)) result else null)
}

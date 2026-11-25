package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** "#rrggbb" to a Color; a calendar with an unreadable colour gets the accent. */
fun parseHex(hex: String?, fallback: Color): Color = try {
    if (hex == null) fallback else Color(android.graphics.Color.parseColor(hex))
} catch (_: IllegalArgumentException) {
    fallback
}

/** The small coloured circle that marks a calendar. */
@Composable
fun CalendarDot(color: Color, size: Dp = 10.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).background(color, CircleShape))
}

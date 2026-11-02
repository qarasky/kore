package dev.qarasky.zero.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Kore's tokens, verbatim. Dark only. */
object ZeroColors {
    val Bg = Color(0xFF16181D)
    val Surface = Color(0xFF1D2026)
    val Raised = Color(0xFF23262D)
    val Border = Color(0xFF2C3038)
    val BorderStrong = Color(0xFF3A3F49)
    val Text = Color(0xFFE6E8EE)
    val Muted = Color(0xFF8A8F9A)
    val Accent = Color(0xFF5B8DEF)
    val AccentHover = Color(0xFF7AA3F2)
    val Danger = Color(0xFFF2777A)
    val Warning = Color(0xFFE5A54B)
}

val UiShape = RoundedCornerShape(6.dp)

private val scheme = darkColorScheme(
    primary = ZeroColors.Accent, onPrimary = Color.White,
    background = ZeroColors.Bg, onBackground = ZeroColors.Text,
    surface = ZeroColors.Surface, onSurface = ZeroColors.Text,
    surfaceVariant = ZeroColors.Raised, onSurfaceVariant = ZeroColors.Muted,
    surfaceContainer = ZeroColors.Surface, surfaceContainerHigh = ZeroColors.Raised, surfaceContainerHighest = ZeroColors.Raised,
    outline = ZeroColors.BorderStrong, outlineVariant = ZeroColors.Border,
    error = ZeroColors.Danger, onError = Color.White,
)

private val type = Typography(
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    titleLarge = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = (-0.02).sp),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp),
    labelLarge = TextStyle(fontSize = 14.sp),
    labelMedium = TextStyle(fontSize = 13.sp),
    labelSmall = TextStyle(fontSize = 12.sp),
)

@Composable
fun ZeroTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type, shapes = Shapes(small = UiShape, medium = UiShape, large = UiShape), content = content)
}

val CodeFont = FontFamily.Monospace

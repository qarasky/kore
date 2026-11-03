package dev.qarasky.koremind.ui.theme

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
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
object KoreMindColors {
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
    primary = KoreMindColors.Accent, onPrimary = Color.White,
    background = KoreMindColors.Bg, onBackground = KoreMindColors.Text,
    surface = KoreMindColors.Surface, onSurface = KoreMindColors.Text,
    surfaceVariant = KoreMindColors.Raised, onSurfaceVariant = KoreMindColors.Muted,
    surfaceContainer = KoreMindColors.Surface, surfaceContainerHigh = KoreMindColors.Raised, surfaceContainerHighest = KoreMindColors.Raised,
    outline = KoreMindColors.BorderStrong, outlineVariant = KoreMindColors.Border,
    error = KoreMindColors.Danger, onError = Color.White,
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
fun KoreMindTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type, shapes = Shapes(small = UiShape, medium = UiShape, large = UiShape)) {
        // A root Surface sets the default text colour; without it unstyled Text is drawn black on the dark background.
        Surface(Modifier.fillMaxSize(), color = KoreMindColors.Bg, contentColor = KoreMindColors.Text) { ProvideMotion(content) }
    }
}

val CodeFont = FontFamily.Monospace

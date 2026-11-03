package dev.qarasky.koremind.ui.theme

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
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
    /** Fill of a confirming destructive button, and its pressed/hover shade. */
    val DangerSolid = Color(0xFFC94B4F)
    val DangerSolidHover = Color(0xFFD65B5F)
    val Warning = Color(0xFFE5A54B)
    // Status colours (StatusDot): for state only; UI errors use Danger.
    val StatusUp = Color(0xFF3FB950)
    val StatusWarn = Color(0xFFF0C54B)
    val StatusDown = Color(0xFFE5484D)
    val StatusMaint = Color(0xFFA371F7)
    val StatusOff = Color(0xFF5B616D)
}

/** `rounded-ui`: controls, cards, nav items. */
val UiShape = RoundedCornerShape(6.dp)
/** `rounded-overlay`: dialogs, menus, sheets. */
val OverlayShape = RoundedCornerShape(8.dp)

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
    // Titles are 600 with -0.01em tracking (DESIGN.md §2 Type).
    titleLarge = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em),
    titleSmall = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.01).em),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 13.sp),
    labelSmall = TextStyle(fontSize = 12.sp),
)

@Composable
fun KoreMindTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type, shapes = Shapes(extraSmall = UiShape, small = UiShape, medium = UiShape, large = OverlayShape, extraLarge = OverlayShape)) {
        // A root Surface sets the default text colour; without it unstyled Text is drawn black on the dark background.
        // Body text is 15 (bodyMedium), not Material's 16 bodyLarge default.
        Surface(Modifier.fillMaxSize(), color = KoreMindColors.Bg, contentColor = KoreMindColors.Text) { ProvideTextStyle(type.bodyMedium) { ProvideMotion(content) } }
    }
}

val CodeFont = FontFamily.Monospace

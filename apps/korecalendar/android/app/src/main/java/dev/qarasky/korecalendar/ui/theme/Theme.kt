package dev.qarasky.korecalendar.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

private val scheme = darkColorScheme(
    primary = Palette.accent,
    onPrimary = Palette.bg,
    background = Palette.bg,
    onBackground = Palette.text,
    surface = Palette.surface,
    onSurface = Palette.text,
    surfaceVariant = Palette.raised,
    onSurfaceVariant = Palette.muted,
    outline = Palette.borderStrong,
    outlineVariant = Palette.border,
    error = Palette.danger,
)

/** kore-ui's radii (DESIGN.md): 6px for controls (fields, buttons, chips), 8px for overlays (menus, dialogs, sheets). */
private val shapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(8.dp),
)

/** Dark only, like every Kore web UI. */
@Composable
fun KoreTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, shapes = shapes, content = content)
}

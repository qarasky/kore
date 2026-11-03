package dev.qarasky.koremind.ui.theme

import android.provider.Settings
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/**
 * One motion language for the app: 100-220 ms, one spring for layout, never decorative.
 * Honors the system "Remove animations" setting (animator duration scale 0).
 */
val LocalMotion = staticCompositionLocalOf { true }

@Composable
fun ProvideMotion(content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val on = remember { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f }
    CompositionLocalProvider(LocalMotion provides on, content = content)
}

object Motion {
    const val Quick = 140
    const val Smooth = 200
}

fun <T> quickSpec(on: Boolean): FiniteAnimationSpec<T> = if (on) tween(Motion.Quick) else snap()
fun <T> smoothSpec(on: Boolean): FiniteAnimationSpec<T> = if (on) tween(Motion.Smooth) else snap()
fun <T> layoutSpec(on: Boolean): FiniteAnimationSpec<T> = if (on) spring(stiffness = Spring.StiffnessMedium, dampingRatio = 0.9f) else snap()

fun enterFade(on: Boolean): EnterTransition = if (on) fadeIn(tween(Motion.Smooth)) else EnterTransition.None
fun exitFade(on: Boolean): ExitTransition = if (on) fadeOut(tween(100)) else ExitTransition.None
fun enterRise(on: Boolean): EnterTransition = if (on) fadeIn(tween(Motion.Smooth)) + slideInVertically(tween(Motion.Smooth)) { it / 10 } else EnterTransition.None
fun enterExpand(on: Boolean): EnterTransition = if (on) expandVertically(layoutSpec()) + fadeIn(tween(Motion.Smooth)) else EnterTransition.None
fun exitShrink(on: Boolean): ExitTransition = if (on) shrinkVertically(layoutSpec()) + fadeOut(tween(100)) else ExitTransition.None
private fun <T> layoutSpec(): FiniteAnimationSpec<T> = spring(stiffness = Spring.StiffnessMedium, dampingRatio = 0.9f)

/** Fades and rises into place once, when first shown. Pass animate = false for things that were already on screen. */
@Composable
fun Appear(animate: Boolean = true, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val on = LocalMotion.current && animate
    val p = remember { Animatable(if (on) 0f else 1f) }
    LaunchedEffect(Unit) { if (p.value < 1f) p.animateTo(1f, tween(Motion.Smooth)) }
    Box(modifier.graphicsLayer { alpha = p.value; translationY = (1f - p.value) * 10.dp.toPx() }) { content() }
}


/** Rows of a LazyColumn fade and slide into place when added, removed or reordered. */
fun androidx.compose.foundation.lazy.LazyItemScope.animateRow(on: Boolean): Modifier = if (on) Modifier.animateItem() else Modifier

package dev.qarasky.koremind.ui.model

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import dev.qarasky.koremind.R

/** The stops of the thinking slider: Default (null) first, then the model's levels. */
fun effortStops(levels: List<String>): List<String?> = listOf<String?>(null) + levels

/** Where the slider sits. A level the model doesn't offer (after switching models) reads as Default. */
fun effortIndex(levels: List<String>, thinking: String?): Int {
    val i = if (thinking == null) -1 else levels.indexOf(thinking)
    return if (i < 0) 0 else i + 1
}

/** The level at a slider position, clamped to the stops. */
fun effortAt(levels: List<String>, index: Int): String? = effortStops(levels).let { it[index.coerceIn(0, it.lastIndex)] }

/** "High effort" / "Default effort". */
@Composable
fun effortLabel(thinking: String?): String =
    if (thinking == null) stringResource(R.string.effort_default) else stringResource(R.string.effort_of, thinkingLabel(thinking))

package dev.qarasky.koremind.ui.model

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.qarasky.koremind.R
import dev.qarasky.koremind.ui.theme.KoreMindColors
import kotlin.math.roundToInt

/** The thinking level of the chosen model as a slider: one stop per level, Default first. Opened from the gauge button. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EffortSheet(levels: List<String>, thinking: String?, onThinking: (String?) -> Unit, onDismiss: () -> Unit) {
    val index = effortIndex(levels, thinking)
    val stops = effortStops(levels).size
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = KoreMindColors.Surface, contentColor = KoreMindColors.Text) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding()) {
            Text(stringResource(R.string.thinking_level), color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall)
            Text(effortLabel(effortAt(levels, index)), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
            Slider(
                value = index.toFloat(),
                onValueChange = { onThinking(effortAt(levels, it.roundToInt())) },
                valueRange = 0f..(stops - 1).toFloat(),
                steps = (stops - 2).coerceAtLeast(0),
                colors = SliderDefaults.colors(thumbColor = KoreMindColors.Accent, activeTrackColor = KoreMindColors.Accent, inactiveTrackColor = KoreMindColors.Raised, activeTickColor = KoreMindColors.Text, inactiveTickColor = KoreMindColors.Muted),
            )
        }
    }
}

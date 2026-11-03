package dev.qarasky.koremind.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import dev.qarasky.koremind.R
import dev.qarasky.koremind.ui.theme.LocalMotion
import dev.qarasky.koremind.ui.theme.UiShape
import dev.qarasky.koremind.ui.theme.enterExpand
import dev.qarasky.koremind.ui.theme.exitShrink
import dev.qarasky.koremind.ui.theme.KoreMindColors

@Composable
fun KoreMindField(
    label: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier,
    hint: String? = null, password: Boolean = false, keyboardType: KeyboardType = KeyboardType.Text, singleLine: Boolean = true, minLines: Int = 1,
) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        supportingText = hint?.let { { Text(it) } },
        singleLine = singleLine, minLines = minLines,
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType),
        shape = UiShape,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = KoreMindColors.Accent, unfocusedBorderColor = KoreMindColors.Border,
            focusedContainerColor = KoreMindColors.Surface, unfocusedContainerColor = KoreMindColors.Surface,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun KoreMindButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, ghost: Boolean = false, danger: Boolean = false) {
    Button(
        onClick = onClick, enabled = enabled, shape = UiShape, modifier = modifier.heightIn(min = 40.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (ghost) KoreMindColors.Raised else KoreMindColors.Accent,
            contentColor = if (danger) KoreMindColors.Danger else if (ghost) KoreMindColors.Text else androidx.compose.ui.graphics.Color.White,
            disabledContainerColor = KoreMindColors.Raised, disabledContentColor = KoreMindColors.Muted,
        ),
    ) { Text(text, style = MaterialTheme.typography.bodyMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.Medium) }
}

@Composable
fun ErrorText(text: String?) {
    // Keep the last message while the exit animation plays.
    var last by remember { mutableStateOf("") }
    if (!text.isNullOrBlank()) last = text
    val on = LocalMotion.current
    AnimatedVisibility(!text.isNullOrBlank(), enter = enterExpand(on), exit = exitShrink(on)) {
        Text(last, color = KoreMindColors.Danger, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun BackBar(title: String, onBack: () -> Unit, trailing: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp).heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
        Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        trailing()
        Spacer(Modifier.width(12.dp))
    }
}

@Composable
fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        content()
    }
}

val HairlineBorder = BorderStroke(1.dp, KoreMindColors.Border)

/** The app's on/off switch: accent track when on, white thumb. */
@Composable
fun KoreMindSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    Switch(
        checked, onChange,
        colors = SwitchDefaults.colors(
            checkedTrackColor = KoreMindColors.Accent, checkedThumbColor = androidx.compose.ui.graphics.Color.White,
            uncheckedTrackColor = KoreMindColors.BorderStrong, uncheckedThumbColor = androidx.compose.ui.graphics.Color.White,
            uncheckedBorderColor = androidx.compose.ui.graphics.Color.Transparent,
        ),
    )
}

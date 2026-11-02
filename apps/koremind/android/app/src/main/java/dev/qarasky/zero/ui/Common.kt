package dev.qarasky.zero.ui

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
import dev.qarasky.zero.R
import dev.qarasky.zero.ui.theme.LocalMotion
import dev.qarasky.zero.ui.theme.UiShape
import dev.qarasky.zero.ui.theme.enterExpand
import dev.qarasky.zero.ui.theme.exitShrink
import dev.qarasky.zero.ui.theme.ZeroColors

@Composable
fun ZeroField(
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
            focusedBorderColor = ZeroColors.Accent, unfocusedBorderColor = ZeroColors.Border,
            focusedContainerColor = ZeroColors.Surface, unfocusedContainerColor = ZeroColors.Surface,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
fun ZeroButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, ghost: Boolean = false, danger: Boolean = false) {
    Button(
        onClick = onClick, enabled = enabled, shape = UiShape, modifier = modifier.heightIn(min = 40.dp),
        contentPadding = PaddingValues(horizontal = 16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (ghost) ZeroColors.Raised else ZeroColors.Accent,
            contentColor = if (danger) ZeroColors.Danger else if (ghost) ZeroColors.Text else androidx.compose.ui.graphics.Color.White,
            disabledContainerColor = ZeroColors.Raised, disabledContentColor = ZeroColors.Muted,
        ),
    ) { Text(text, style = MaterialTheme.typography.labelLarge) }
}

@Composable
fun ErrorText(text: String?) {
    // Keep the last message while the exit animation plays.
    var last by remember { mutableStateOf("") }
    if (!text.isNullOrBlank()) last = text
    val on = LocalMotion.current
    AnimatedVisibility(!text.isNullOrBlank(), enter = enterExpand(on), exit = exitShrink(on)) {
        Text(last, color = ZeroColors.Danger, style = MaterialTheme.typography.bodySmall)
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

val HairlineBorder = BorderStroke(1.dp, ZeroColors.Border)

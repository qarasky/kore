package dev.qarasky.koremind.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.qarasky.koremind.R
import dev.qarasky.koremind.data.showUpdateBanner
import dev.qarasky.koremind.ui.theme.KoreMindColors
import dev.qarasky.koremind.ui.theme.LocalMotion
import dev.qarasky.koremind.ui.theme.enterExpand
import dev.qarasky.koremind.ui.theme.exitShrink

/** What the update action says right now: "Update", "Downloading 42%", "Installing…", or null when there is nothing to do. */
@Composable
fun updateActionText(u: UpdateUi): String? = when (u) {
    is UpdateUi.Available -> stringResource(R.string.update_now)
    is UpdateUi.Downloading -> stringResource(R.string.update_downloading, (u.progress * 100).toInt())
    is UpdateUi.Installing -> stringResource(R.string.update_installing)
    is UpdateUi.Failed -> if (u.info != null) stringResource(R.string.update_now) else null
    else -> null
}

/** A thin bar over the chat when a newer release is out. Closing it hides it until the next release. */
@Composable
fun UpdateBanner(vm: AppViewModel) {
    val u by vm.update.collectAsStateWithLifecycle()
    val dismissed by vm.dismissedUpdate.collectAsStateWithLifecycle()
    val info = u.release
    AnimatedVisibility(showUpdateBanner(info, dismissed), enter = enterExpand(LocalMotion.current), exit = exitShrink(LocalMotion.current)) {
        val busy = u is UpdateUi.Downloading || u is UpdateUi.Installing
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                .border(1.dp, KoreMindColors.Accent.copy(alpha = 0.4f), RoundedCornerShape(6.dp))
                .background(KoreMindColors.Surface, RoundedCornerShape(6.dp))
                .heightIn(min = 44.dp).padding(start = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(stringResource(R.string.update_available, info?.version ?: ""), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            updateActionText(u)?.let { label ->
                Text(label, color = if (busy) KoreMindColors.Muted else KoreMindColors.Accent, modifier = Modifier.clickable(enabled = !busy, onClick = vm::installUpdate).padding(8.dp))
            }
            if (!busy) IconButton(onClick = vm::dismissUpdate) { Icon(Icons.Filled.Close, stringResource(R.string.dismiss), Modifier.size(18.dp), tint = KoreMindColors.Muted) }
        }
    }
}

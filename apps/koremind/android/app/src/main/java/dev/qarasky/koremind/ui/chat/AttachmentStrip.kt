package dev.qarasky.koremind.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.qarasky.koremind.R
import dev.qarasky.koremind.ui.theme.KoreMindColors
import dev.qarasky.koremind.ui.theme.LocalMotion
import dev.qarasky.koremind.ui.theme.enterExpand
import dev.qarasky.koremind.ui.theme.exitShrink

/** The files picked for the next message, above the text: a horizontally scrolling row of thumbnails with their upload state. */
@Composable
fun AttachmentStrip(files: List<PendingFile>, onRemove: (String) -> Unit, onRetry: (String) -> Unit) {
    val on = LocalMotion.current
    AnimatedVisibility(files.isNotEmpty(), enter = enterExpand(on), exit = exitShrink(on)) {
        // Keep showing the files that are on their way out.
        val shown = remember { mutableStateOf(files) }
        if (files.isNotEmpty()) shown.value = files
        LazyRow(Modifier.padding(4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(shown.value, key = { it.localId }) { f -> Thumb(f, onRemove, onRetry) }
        }
    }
}

@Composable
private fun Thumb(f: PendingFile, onRemove: (String) -> Unit, onRetry: (String) -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    val removeLabel = stringResource(R.string.remove_file, f.name)
    Box(Modifier.size(64.dp).clip(shape).background(KoreMindColors.Raised).border(1.dp, if (f.state == UploadState.Failed) KoreMindColors.Danger else KoreMindColors.Border, shape)) {
        if (f.mime.startsWith("image/")) AsyncImage(f.uri, f.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Column(Modifier.fillMaxSize().padding(4.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(painterResource(R.drawable.ic_paperclip), null, Modifier.size(20.dp), tint = KoreMindColors.Muted)
            Text(f.name, maxLines = 1, overflow = TextOverflow.Ellipsis, color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall)
        }
        when (f.state) {
            UploadState.Uploading -> Box(Modifier.fillMaxSize().background(KoreMindColors.Bg.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                val label = stringResource(R.string.uploading)
                CircularProgressIndicator(Modifier.size(22.dp).semantics { contentDescription = label }, color = KoreMindColors.Text, strokeWidth = 2.dp)
            }
            UploadState.Failed -> {
                val label = stringResource(R.string.retry) + " " + f.name
                Box(Modifier.fillMaxSize().background(KoreMindColors.Bg.copy(alpha = 0.7f)).clickable { onRetry(f.localId) }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Refresh, null, Modifier.size(22.dp), tint = KoreMindColors.Danger)
                }
            }
            UploadState.Ready -> {}
        }
        Box(Modifier.align(Alignment.TopEnd).padding(2.dp).size(24.dp).clip(RoundedCornerShape(12.dp)).background(KoreMindColors.Bg.copy(alpha = 0.7f)).clickable { onRemove(f.localId) }.semantics { contentDescription = removeLabel }, contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Close, null, Modifier.size(14.dp), tint = KoreMindColors.Text)
        }
    }
}

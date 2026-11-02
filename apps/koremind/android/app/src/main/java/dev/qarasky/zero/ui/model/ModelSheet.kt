package dev.qarasky.zero.ui.model

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.qarasky.zero.R
import dev.qarasky.zero.data.ProviderInfo
import dev.qarasky.zero.ui.Choice
import dev.qarasky.zero.ui.theme.LocalMotion
import dev.qarasky.zero.ui.theme.ZeroColors
import dev.qarasky.zero.ui.theme.animateRow
import dev.qarasky.zero.ui.theme.quickSpec

/** Bottom sheet version of the picker: provider rail on the left, search and rows on the right. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSheet(
    providers: List<ProviderInfo>, favorites: Set<String>, choice: Choice?,
    onSelect: (String, String) -> Unit, onThinking: (String?) -> Unit, onFavorite: (String) -> Unit, onDismiss: () -> Unit,
) {
    var rail by remember { mutableStateOf(if (favorites.isNotEmpty()) "favorites" else choice?.providerId ?: providers.firstOrNull()?.id ?: "favorites") }
    var query by remember { mutableStateOf("") }
    val rows = filterModels(providers, favorites, rail, query)
    val levels = providers.firstOrNull { it.id == choice?.providerId }?.models?.firstOrNull { it.id == choice?.modelId }?.thinkingLevels ?: emptyList()

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = ZeroColors.Surface, contentColor = ZeroColors.Text) {
        Row(Modifier.fillMaxWidth().heightIn(min = 280.dp, max = 460.dp).navigationBarsPadding()) {
            Column(Modifier.width(52.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                RailItem(rail == "favorites", stringResource(R.string.favorites)) { rail = "favorites" }.also { }
                Box(Modifier.width(28.dp).size(width = 28.dp, height = 1.dp).background(ZeroColors.Border))
                providers.forEach { p -> RailItem(rail == p.id, p.name, label = p.name.take(1).uppercase()) { rail = p.id } }
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(ZeroColors.Border))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.Search, null, tint = ZeroColors.Muted, modifier = Modifier.size(18.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isEmpty()) Text(stringResource(R.string.search_models), color = ZeroColors.Muted)
                        BasicTextField(query, { query = it }, singleLine = true, textStyle = TextStyle(color = ZeroColors.Text, fontSize = MaterialTheme.typography.bodyMedium.fontSize), cursorBrush = SolidColor(ZeroColors.Accent), modifier = Modifier.fillMaxWidth())
                    }
                }
                Box(Modifier.fillMaxWidth().size(width = 1.dp, height = 2.dp).background(ZeroColors.Accent))
                LazyColumn(Modifier.weight(1f, fill = false)) {
                    if (rows.isEmpty()) item { Text(if (rail == "favorites" && query.isEmpty()) stringResource(R.string.no_favorites) else stringResource(R.string.no_models), color = ZeroColors.Muted, modifier = Modifier.padding(vertical = 14.dp)) }
                    items(rows, key = { it.key }) { r ->
                        val active = r.providerId == choice?.providerId && r.model.id == choice.modelId
                        val on = LocalMotion.current
                        val rowBg by animateColorAsState(if (active) ZeroColors.Raised else androidx.compose.ui.graphics.Color.Transparent, quickSpec(on), label = "row-bg")
                        Row(animateRow(on).fillMaxWidth().heightIn(min = 48.dp).background(rowBg, RoundedCornerShape(6.dp)).clickable { onSelect(r.providerId, r.model.id); onDismiss() }.padding(start = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(r.model.name, Modifier.weight(1f), maxLines = 1)
                            if (!r.model.vision) Text(stringResource(R.string.no_photos), color = ZeroColors.Muted, style = MaterialTheme.typography.labelSmall)
                            val fav = r.key in favorites
                            IconButton(onClick = { onFavorite(r.key) }) {
                                // The star pops in when pinned and fades out when unpinned.
                                AnimatedContent(fav, label = "star", transitionSpec = { (fadeIn(quickSpec(on)) + scaleIn(quickSpec(on), initialScale = 0.6f)) togetherWith (fadeOut(quickSpec(on)) + scaleOut(quickSpec(on), targetScale = 0.6f)) }) { f ->
                                    Icon(if (f) Icons.Filled.Star else Icons.Outlined.Star, stringResource(if (f) R.string.remove_favorite else R.string.add_favorite), tint = if (f) ZeroColors.Accent else ZeroColors.Muted)
                                }
                            }
                            if (active) Icon(Icons.Filled.Check, null, Modifier.padding(end = 8.dp).size(18.dp))
                        }
                    }
                }
                if (levels.isNotEmpty()) {
                    Text(stringResource(R.string.thinking_level), color = ZeroColors.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        (listOf<String?>(null) + levels).forEach { l ->
                            val sel = choice?.thinking == l
                            Text(if (l == null) stringResource(R.string.thinking_default) else thinkingLabel(l), style = MaterialTheme.typography.labelMedium, color = if (sel) androidx.compose.ui.graphics.Color.White else ZeroColors.Text,
                                modifier = Modifier.background(if (sel) ZeroColors.Accent else ZeroColors.Raised, RoundedCornerShape(6.dp)).clickable { onThinking(l) }.padding(horizontal = 12.dp, vertical = 8.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RailItem(active: Boolean, description: String, label: String? = null, onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClick = onClick).semantics { contentDescription = description }, contentAlignment = Alignment.Center) {
        if (label == null) Icon(Icons.Filled.Star, null, tint = ZeroColors.Text)
        else Box(Modifier.size(26.dp).background(ZeroColors.Raised, CircleShape), contentAlignment = Alignment.Center) { Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold) }
        val alpha by animateFloatAsState(if (active) 1f else 0f, quickSpec(LocalMotion.current), label = "rail-marker")
        Box(Modifier.align(Alignment.CenterEnd).size(width = 3.dp, height = 24.dp).graphicsLayer { this.alpha = alpha }.background(ZeroColors.Accent, RoundedCornerShape(2.dp)))
    }
}

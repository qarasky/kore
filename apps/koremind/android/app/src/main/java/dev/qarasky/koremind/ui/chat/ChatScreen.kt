package dev.qarasky.koremind.ui.chat

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.qarasky.koremind.R
import dev.qarasky.koremind.ui.AppViewModel
import dev.qarasky.koremind.ui.ErrorText
import dev.qarasky.koremind.ui.model.ModelSheet
import dev.qarasky.koremind.ui.model.lacksVision
import dev.qarasky.koremind.ui.model.thinkingLabel
import dev.qarasky.koremind.ui.theme.Appear
import dev.qarasky.koremind.ui.theme.LocalMotion
import dev.qarasky.koremind.ui.theme.KoreMindColors
import dev.qarasky.koremind.ui.theme.animateRow
import dev.qarasky.koremind.ui.theme.enterExpand
import dev.qarasky.koremind.ui.theme.enterRise
import dev.qarasky.koremind.ui.theme.exitFade
import dev.qarasky.koremind.ui.theme.exitShrink
import dev.qarasky.koremind.ui.theme.quickSpec
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(vm: AppViewModel, onSettings: () -> Unit, onProviders: () -> Unit) {
    val state by vm.chat.collectAsStateWithLifecycle()
    val chats by vm.chats.collectAsStateWithLifecycle()
    val chatId by vm.chatId.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val empty = state.messages.isEmpty() && state.draft == null
    val title = chats.firstOrNull { it.id == chatId }?.title ?: stringResource(R.string.app_name)
    val on = LocalMotion.current
    val listKey = rememberListKey(chatId)

    ModalNavigationDrawer(
        drawerState = drawer,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = KoreMindColors.Surface, modifier = Modifier.widthIn(max = 300.dp)) {
                HistoryDrawer(
                    chats = chats, activeId = chatId,
                    onNew = { vm.newChat(); scope.launch { drawer.close() } },
                    onOpen = { vm.openChat(it); scope.launch { drawer.close() } },
                    onDelete = vm::deleteChat,
                    onSettings = { scope.launch { drawer.close() }; onSettings() },
                    email = vm.session.value.email,
                    onSignOut = vm::signOut,
                )
            }
        },
    ) {
        Column(Modifier.fillMaxSize().background(KoreMindColors.Bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { scope.launch { drawer.open() } }) { Icon(Icons.Filled.Menu, stringResource(R.string.menu)) }
                val shownTitle = if (empty) stringResource(R.string.app_name) else title
                AnimatedContent(shownTitle, Modifier.weight(1f), label = "title", transitionSpec = { fadeIn(quickSpec(on)) togetherWith fadeOut(quickSpec(on)) }) { t ->
                    Text(t, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
                }
                if (chatId != null && !empty) IconButton(onClick = { chatId?.let(vm::deleteChat) }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete_chat), tint = KoreMindColors.Muted) }
                else Spacer(Modifier.size(48.dp))
            }
            if (empty) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Appear { Text(stringResource(R.string.home_greeting), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) } }
            else androidx.compose.runtime.key(listKey) { MessageList(state, Modifier.weight(1f), vm::answerApproval) }

            AnimatedVisibility(state.connectProvider, enter = enterExpand(on), exit = exitShrink(on)) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).border(1.dp, KoreMindColors.Warning.copy(alpha = 0.4f), RoundedCornerShape(6.dp)).background(KoreMindColors.Surface, RoundedCornerShape(6.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(stringResource(R.string.connect_provider), fontWeight = FontWeight.Medium)
                    Text(stringResource(R.string.connect_provider_hint), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
                    Text(stringResource(R.string.open_settings), color = KoreMindColors.Accent, modifier = Modifier.clickable(onClick = onProviders).padding(vertical = 4.dp))
                }
            }
            Box(Modifier.padding(horizontal = 20.dp)) { ErrorText(if (state.connectProvider) null else state.error?.message) }
            Composer(vm, busy, onProviders)
        }
    }
}

/** A key that stays the same while a new chat gets its id, but changes when you switch chats, so opened messages don't animate in. */
@Composable
private fun rememberListKey(chatId: String?): Any {
    class Holder { var prev: String? = null; var key: Any = Any() }
    val h = remember { Holder() }
    if (chatId != h.prev) { if (h.prev != null) h.key = Any(); h.prev = chatId }
    return h.key
}

@Composable
private fun MessageList(state: ChatUiState, modifier: Modifier, onApproval: (String, Boolean) -> Unit) {
    val list = rememberLazyListState()
    val count = state.messages.size + if (state.draft != null) 1 else 0
    val tail = (state.draft?.text?.length ?: 0) + (state.draft?.approvals?.size ?: 0) * 1000 + (state.draft?.activity?.size ?: 0)
    // Messages already on screen when the list opens don't animate; new ones rise into place.
    val shown = remember { state.messages.map { it.id }.toSet() }
    LaunchedEffect(count, tail) { if (count > 0) list.scrollToItem(count - 1, scrollOffset = Int.MAX_VALUE / 2) }
    LazyColumn(modifier.fillMaxWidth(), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        items(state.messages, key = { it.id }) { m ->
            if (m.role == "user") Appear(animate = m.id !in shown) { UserBubble(m) } else AssistantMessage(m.text, m.sources, activity = m.activity)
        }
        state.draft?.let { d -> item(key = "draft") { Appear { AssistantMessage(d.text, d.sources, d.status, d.activity, d.approvals, d.expired, animateChips = true, onApproval = onApproval) } } }
    }
}

@Composable
private fun Composer(vm: AppViewModel, busy: Boolean, onProviders: () -> Unit) {
    val pending by vm.pending.collectAsStateWithLifecycle()
    val uploadError by vm.uploadError.collectAsStateWithLifecycle()
    val providers by vm.providers.collectAsStateWithLifecycle()
    val favorites by vm.favorites.collectAsStateWithLifecycle()
    val choice by vm.choice.collectAsStateWithLifecycle()
    var text by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(false) }
    val resolver = LocalContext.current.contentResolver
    val on = LocalMotion.current
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris -> uris.forEach { vm.attach(resolver, it) } }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> uris.forEach { vm.attach(resolver, it) } }
    val sendLabel = stringResource(R.string.send)
    val stopLabel = stringResource(R.string.stop)
    val currentModel = providers.firstOrNull { it.id == choice?.providerId }?.models?.firstOrNull { it.id == choice?.modelId }

    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Column(Modifier.fillMaxWidth().background(KoreMindColors.Surface, RoundedCornerShape(20.dp)).border(1.dp, KoreMindColors.Border, RoundedCornerShape(20.dp)).padding(8.dp)) {
            AnimatedVisibility(pending.isNotEmpty(), enter = enterExpand(on), exit = exitShrink(on)) {
                // Keep showing the chips that are on their way out.
                val shownPending = remember { mutableStateOf(pending) }
                if (pending.isNotEmpty()) shownPending.value = pending
                LazyRow(Modifier.padding(4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(shownPending.value, key = { it.attachment.id }) { p ->
                        Row(animateRow(on).background(KoreMindColors.Raised, RoundedCornerShape(6.dp)).padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(p.attachment.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium, modifier = Modifier.widthIn(max = 140.dp))
                            IconButton(onClick = { vm.removePending(p.attachment.id) }, Modifier.size(28.dp)) { Icon(Icons.Filled.Close, stringResource(R.string.delete), Modifier.size(14.dp)) }
                        }
                    }
                }
            }
            Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
                if (text.isEmpty()) Text(stringResource(R.string.composer_placeholder), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodyLarge)
                BasicTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(max = 160.dp), textStyle = MaterialTheme.typography.bodyLarge.copy(color = KoreMindColors.Text), cursorBrush = SolidColor(KoreMindColors.Accent), keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box {
                    IconButton(onClick = { menu = true }, Modifier.size(36.dp)) { Icon(Icons.Filled.Add, stringResource(R.string.attach), tint = KoreMindColors.Muted) }
                    DropdownMenu(menu, { menu = false }, containerColor = KoreMindColors.Raised) {
                        DropdownMenuItem({ Text(stringResource(R.string.attach_photo)) }, { menu = false; photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
                        DropdownMenuItem({ Text(stringResource(R.string.attach_file)) }, { menu = false; files.launch(arrayOf("application/pdf", "text/*", "application/json", "image/*")) })
                    }
                }
                if (currentModel != null) Row(Modifier.heightIn(min = 36.dp).clickable { sheet = true }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(currentModel.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge, modifier = Modifier.widthIn(max = 150.dp))
                    choice?.thinking?.let { Text(" ${thinkingLabel(it)}", color = KoreMindColors.Muted, style = MaterialTheme.typography.labelLarge) }
                    Icon(Icons.Filled.KeyboardArrowDown, null, tint = KoreMindColors.Muted, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.weight(1f))
                val can = canSend(text, pending.size, busy = false, hasModel = currentModel != null)
                AnimatedContent(
                    busy, label = "send-stop",
                    transitionSpec = { (fadeIn(quickSpec(on)) + scaleIn(quickSpec(on), initialScale = 0.8f)) togetherWith (fadeOut(quickSpec(on)) + scaleOut(quickSpec(on), targetScale = 0.8f)) },
                ) { isBusy ->
                    if (isBusy) Box(Modifier.size(40.dp).background(KoreMindColors.Text, CircleShape).clickable { vm.stop() }.semantics { contentDescription = stopLabel }, contentAlignment = Alignment.Center) { Box(Modifier.size(12.dp).background(KoreMindColors.Bg, RoundedCornerShape(2.dp))) }
                    else {
                        val bg by animateColorAsState(if (can) KoreMindColors.Accent else KoreMindColors.Raised, quickSpec(on), label = "send-bg")
                        val scale by animateFloatAsState(if (can) 1f else 0.92f, quickSpec(on), label = "send-scale")
                        Box(Modifier.size(40.dp).graphicsLayer { scaleX = scale; scaleY = scale }.background(bg, CircleShape).clickable(enabled = can) { vm.send(text.trim()); text = "" }.semantics { contentDescription = sendLabel }, contentAlignment = Alignment.Center) {
                            Icon(Icons.AutoMirrored.Filled.Send, null, tint = if (can) Color.White else KoreMindColors.Muted, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
        ErrorText(uploadError ?: if (currentModel == null) stringResource(R.string.no_model) else if (lacksVision(pending.map { it.attachment }, currentModel)) stringResource(R.string.no_photos_warning) else null)
    }
    if (sheet) ModelSheet(providers, favorites, choice, vm::selectModel, vm::setThinking, vm::toggleFavorite, onProviders) { sheet = false }
}

@Composable
private fun HistoryDrawer(chats: List<dev.qarasky.koremind.data.ChatSummary>, activeId: String?, onNew: () -> Unit, onOpen: (String) -> Unit, onDelete: (String) -> Unit, onSettings: () -> Unit, email: String?, onSignOut: () -> Unit) {
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Box(Modifier.padding(16.dp)) { Wordmark() }
        Row(Modifier.padding(horizontal = 12.dp).fillMaxWidth().heightIn(min = 40.dp).background(KoreMindColors.Raised, RoundedCornerShape(6.dp)).clickable(onClick = onNew).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Filled.Add, null, Modifier.size(16.dp)); Text(stringResource(R.string.new_chat), style = MaterialTheme.typography.labelLarge)
        }
        LazyColumn(Modifier.weight(1f).padding(top = 12.dp, start = 8.dp, end = 8.dp)) {
            if (chats.isEmpty()) item { Text(stringResource(R.string.no_chats), color = KoreMindColors.Muted, modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall) }
            items(chats, key = { it.id }) { c ->
                val bg by animateColorAsState(if (c.id == activeId) KoreMindColors.Raised else Color.Transparent, quickSpec(LocalMotion.current), label = "chat-row")
                Row(animateRow(LocalMotion.current).fillMaxWidth().heightIn(min = 44.dp).background(bg, RoundedCornerShape(6.dp)).clickable { onOpen(c.id) }.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(c.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                    IconButton(onClick = { onDelete(c.id) }, Modifier.size(36.dp)) { Icon(Icons.Filled.Delete, stringResource(R.string.delete_chat), Modifier.size(16.dp), tint = KoreMindColors.Muted) }
                }
            }
        }
        Box(Modifier.fillMaxWidth().size(width = 1.dp, height = 1.dp).background(KoreMindColors.Border))
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = onSettings).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Icons.Filled.Settings, null, Modifier.size(18.dp)); Text(stringResource(R.string.settings))
        }
        Text(email ?: "", color = KoreMindColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth().clickable(onClick = onSignOut).padding(horizontal = 20.dp, vertical = 12.dp))
    }
}

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
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.core.content.FileProvider
import android.content.ActivityNotFoundException
import dev.qarasky.koremind.data.Attachment
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
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
import dev.qarasky.koremind.ui.UpdateBanner
import dev.qarasky.koremind.ui.ErrorText
import dev.qarasky.koremind.ui.model.ModelSheet
import dev.qarasky.koremind.ui.model.lacksVision
import dev.qarasky.koremind.ui.model.EffortSheet
import dev.qarasky.koremind.ui.model.effortAt
import dev.qarasky.koremind.ui.model.effortIndex
import dev.qarasky.koremind.ui.model.effortLabel
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
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.isActive

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
    val closeKeyboard = rememberCloseKeyboard()
    // Opening the menu by button or by swipe puts the keyboard away first.
    LaunchedEffect(drawer.targetValue) { if (drawer.targetValue == DrawerValue.Open) closeKeyboard() }

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
                IconButton(onClick = { closeKeyboard(); scope.launch { drawer.open() } }) { Icon(Icons.Filled.Menu, stringResource(R.string.menu)) }
                val shownTitle = if (empty) stringResource(R.string.app_name) else title
                AnimatedContent(shownTitle, Modifier.weight(1f), label = "title", transitionSpec = { fadeIn(quickSpec(on)) togetherWith fadeOut(quickSpec(on)) }) { t ->
                    Text(t, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
                }
                if (!empty) IconButton(onClick = { closeKeyboard(); vm.newChat() }) { Icon(Icons.Filled.Add, stringResource(R.string.new_chat), tint = KoreMindColors.Muted) }
                else Spacer(Modifier.size(48.dp))
            }
            UpdateBanner(vm)
            if (empty) Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { Appear { Text(stringResource(R.string.home_greeting), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold) } }
            else androidx.compose.runtime.key(listKey) { MessageList(state, busy, Modifier.weight(1f), vm::answerApproval, vm::edit, vm::showVariant) }

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

/** Puts the on-screen keyboard away and takes focus off the message field. Called before a menu or sheet opens. */
@Composable
private fun rememberCloseKeyboard(): () -> Unit {
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    return { keyboard?.hide(); focus.clearFocus() }
}

/** Pixels between the end of the last item and the bottom of the list; huge while the last item is off screen. */
private fun LazyListState.distanceToBottom(): Float {
    val info = layoutInfo
    val last = info.visibleItemsInfo.lastOrNull() ?: return 0f
    if (last.index < info.totalItemsCount - 1) return Float.MAX_VALUE
    return (last.offset + last.size - (info.viewportEndOffset - info.afterContentPadding)).coerceAtLeast(0).toFloat()
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
private fun MessageList(
    state: ChatUiState, busy: Boolean, modifier: Modifier, onApproval: (String, Boolean) -> Unit,
    onEdit: (id: String, text: String) -> Unit, onVariant: (id: String) -> Unit,
) {
    val list = rememberLazyListState()
    val count = state.messages.size + if (state.draft != null) 1 else 0
    // Messages already on screen when the list opens don't animate; new ones rise into place.
    val shown = remember { state.messages.map { it.id }.toSet() }
    val density = LocalDensity.current.density
    // Keep the newest text in view, easing towards it frame by frame instead of snapping on every token.
    var following by remember { mutableStateOf(true) }
    val dragged by list.interactionSource.collectIsDraggedAsState()
    // Any upward move by the reader stops following; it never fights their finger.
    val reader = remember {
        object : NestedScrollConnection {
            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (consumed.y > 0f) following = false
                return Offset.Zero
            }
        }
    }
    // When a scroll settles at (or near) the bottom, follow again.
    LaunchedEffect(list) {
        snapshotFlow { list.isScrollInProgress }.filter { !it }.collect {
            following = nextFollowing(following, list.distanceToBottom() / density, movedUp = false)
        }
    }
    // Sending a message always brings you back to the bottom.
    LaunchedEffect(count) { if (state.messages.lastOrNull()?.role == "user") following = true }
    LaunchedEffect(list, following, dragged) {
        if (!following || dragged) return@LaunchedEffect
        snapshotFlow { list.distanceToBottom() }.filter { it >= 1f }.collect {
            var last = withFrameNanos { it }
            while (true) {
                val now = withFrameNanos { it }
                val distance = list.distanceToBottom()
                val viewport = list.layoutInfo.viewportSize.height.toFloat()
                val step = followStep(distance, viewport, (now - last) / 1_000_000f)
                last = now
                if (step <= 0f || distance < 1f) break
                try {
                    if (distance > viewport * 2) list.scrollToItem(list.layoutInfo.totalItemsCount - 1, scrollOffset = Int.MAX_VALUE / 2)
                    else list.scrollBy(step)
                } catch (e: CancellationException) {
                    if (!isActive) throw e
                    break // the reader took over
                }
            }
        }
    }
    LazyColumn(modifier.fillMaxWidth().nestedScroll(reader), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        items(state.messages, key = { it.id }) { m ->
            if (m.role == "user") Appear(animate = m.id !in shown) { UserBubble(m, busy, onEdit, onVariant) } else AssistantMessage(m.text, m.sources, activity = m.activity)
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
    var effortSheet by remember { mutableStateOf(false) }
    val closeKeyboard = rememberCloseKeyboard()
    val resolver = LocalContext.current.contentResolver
    val on = LocalMotion.current
    val photos = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris -> uris.forEach { vm.attach(resolver, it) } }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> uris.forEach { vm.attach(resolver, it) } }
    // A photo from the camera is written to cache/camera/ through our FileProvider, then attached like any picked file. The path is saved
    // across the camera app so a recreated activity still finds it.
    val context = LocalContext.current
    var cameraPath by rememberSaveable { mutableStateOf<String?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = cameraPath?.let(::File)
        cameraPath = null
        if (file != null && ok) vm.attach(resolver, FileProvider.getUriForFile(context, "${context.packageName}.files", file)) else file?.delete()
    }
    val noCamera = stringResource(R.string.no_camera)
    fun takePhoto() {
        val dir = File(context.cacheDir, "camera").apply { mkdirs() }
        val file = File(dir, "IMG_" + SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date()) + ".jpg")
        cameraPath = file.path
        try { camera.launch(FileProvider.getUriForFile(context, "${context.packageName}.files", file)) }
        catch (_: ActivityNotFoundException) { cameraPath = null; file.delete(); vm.showUploadError(noCamera) }
    }
    val sendLabel = stringResource(R.string.send)
    val stopLabel = stringResource(R.string.stop)
    val currentModel = providers.firstOrNull { it.id == choice?.providerId }?.models?.firstOrNull { it.id == choice?.modelId }
    val levels = currentModel?.thinkingLevels ?: emptyList()

    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Column(Modifier.fillMaxWidth().background(KoreMindColors.Surface, RoundedCornerShape(20.dp)).border(1.dp, KoreMindColors.Border, RoundedCornerShape(20.dp)).padding(8.dp)) {
            AttachmentStrip(pending, vm::removePending) { vm.retry(resolver, it) }
            Box(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp)) {
                if (text.isEmpty()) Text(stringResource(R.string.composer_placeholder), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodyLarge)
                BasicTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(max = 160.dp), textStyle = MaterialTheme.typography.bodyLarge.copy(color = KoreMindColors.Text), cursorBrush = SolidColor(KoreMindColors.Accent), keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box {
                    IconButton(onClick = { closeKeyboard(); menu = true }, Modifier.size(36.dp)) { Icon(Icons.Filled.Add, stringResource(R.string.attach), tint = KoreMindColors.Muted) }
                    DropdownMenu(menu, { menu = false }, containerColor = KoreMindColors.Raised) {
                        val menuIcon = @Composable { res: Int -> Icon(painterResource(res), null, Modifier.size(20.dp), tint = KoreMindColors.Muted) }
                        DropdownMenuItem({ Text(stringResource(R.string.attach_photo)) }, { menu = false; photos.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, leadingIcon = { menuIcon(R.drawable.ic_image) })
                        DropdownMenuItem({ Text(stringResource(R.string.take_photo)) }, { menu = false; takePhoto() }, leadingIcon = { menuIcon(R.drawable.ic_camera) })
                        DropdownMenuItem({ Text(stringResource(R.string.attach_file)) }, { menu = false; files.launch(arrayOf("application/pdf", "text/*", "application/json", "image/*")) }, leadingIcon = { menuIcon(R.drawable.ic_paperclip) })
                    }
                }
                if (currentModel != null) Row(Modifier.heightIn(min = 36.dp).clickable { closeKeyboard(); sheet = true }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(currentModel.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge, modifier = Modifier.widthIn(max = 150.dp))
                    Icon(Icons.Filled.KeyboardArrowDown, null, tint = KoreMindColors.Muted, modifier = Modifier.size(18.dp))
                }
                if (levels.isNotEmpty()) {
                    val effort = effortLabel(effortAt(levels, effortIndex(levels, choice?.thinking)))
                    val gaugeLabel = stringResource(R.string.thinking_level) + ": " + effort
                    IconButton(onClick = { closeKeyboard(); effortSheet = true }, Modifier.size(36.dp).semantics { contentDescription = gaugeLabel }) {
                        Icon(painterResource(R.drawable.ic_gauge), null, Modifier.size(20.dp), tint = if (choice?.thinking != null) KoreMindColors.Accent else KoreMindColors.Muted)
                    }
                }
                Spacer(Modifier.weight(1f))
                val can = canSend(text, readyAttachments(pending).size, uploadingCount(pending), busy = false, hasModel = currentModel != null)
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
        ErrorText(uploadError ?: uploadNotice(pending, stringResource(R.string.upload_failed)) ?: if (currentModel == null) stringResource(R.string.no_model) else if (lacksVision(pending.filter { it.state != UploadState.Failed }.map { Attachment("", it.name, it.mime, 0) }, currentModel)) stringResource(R.string.no_photos_warning) else null)
    }
    if (sheet) ModelSheet(providers, favorites, choice, vm::selectModel, vm::toggleFavorite, onProviders) { sheet = false }
    if (effortSheet) EffortSheet(levels, choice?.thinking, vm::setThinking) { effortSheet = false }
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

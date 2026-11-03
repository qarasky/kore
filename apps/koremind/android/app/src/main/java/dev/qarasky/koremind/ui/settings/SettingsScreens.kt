package dev.qarasky.koremind.ui.settings

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.qarasky.koremind.R
import dev.qarasky.koremind.data.MemoryEntry
import dev.qarasky.koremind.data.ProviderConnection
import dev.qarasky.koremind.data.Settings
import dev.qarasky.koremind.ui.AppViewModel
import dev.qarasky.koremind.ui.BackBar
import dev.qarasky.koremind.ui.ErrorText
import dev.qarasky.koremind.ui.HairlineBorder
import dev.qarasky.koremind.ui.KoreMindButton
import dev.qarasky.koremind.ui.KoreMindField
import dev.qarasky.koremind.ui.KoreMindSwitch
import dev.qarasky.koremind.ui.model.ProviderIcon
import dev.qarasky.koremind.ui.theme.LocalMotion
import dev.qarasky.koremind.ui.theme.UiShape
import dev.qarasky.koremind.ui.theme.KoreMindColors
import dev.qarasky.koremind.ui.theme.animateRow
import dev.qarasky.koremind.ui.theme.enterExpand
import dev.qarasky.koremind.ui.theme.enterRise
import dev.qarasky.koremind.ui.theme.exitFade
import dev.qarasky.koremind.ui.theme.exitShrink
import dev.qarasky.koremind.ui.theme.layoutSpec
import dev.qarasky.koremind.ui.theme.quickSpec
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class SaveState { Idle, Saving, Saved, Error }

private const val AUTOSAVE_MS = 700L

@Composable
fun SettingsScreen(vm: AppViewModel, initialSection: String?, onBack: () -> Unit, onChangeServer: () -> Unit) {
    val on = LocalMotion.current
    var section by remember(initialSection) { mutableStateOf(sectionFromRoute(initialSection).id) }
    var settings by remember { mutableStateOf<Settings?>(null) }
    var baseline by remember { mutableStateOf<Settings?>(null) }
    var save by remember { mutableStateOf(SaveState.Idle) }

    LaunchedEffect(Unit) {
        val s = try { vm.api?.settings() } catch (_: Exception) { null }
        settings = s; baseline = s
    }
    // Autosave: a short pause after the last edit. The first loaded value is the baseline, not a change.
    LaunchedEffect(settings) {
        val s = settings ?: return@LaunchedEffect
        if (s == baseline) return@LaunchedEffect
        delay(AUTOSAVE_MS)
        save = SaveState.Saving
        try {
            vm.api?.putSettings(s)
            // The picker follows the provider switches right away.
            if (baseline?.let { providerPrefsChanged(it, s) } == true) vm.refreshModels()
            baseline = s
            save = SaveState.Saved
            delay(1600)
            if (save == SaveState.Saved) save = SaveState.Idle
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (_: Exception) { save = SaveState.Error }
    }
    // Leaving within the pause must not lose the edit.
    val latest by rememberUpdatedState(settings)
    val base by rememberUpdatedState(baseline)
    DisposableEffect(Unit) { onDispose { val s = latest; if (s != null && s != base) vm.saveSettingsNow(s) } }

    Column(Modifier.fillMaxSize().background(KoreMindColors.Bg).statusBarsPadding().navigationBarsPadding()) {
        BackBar(stringResource(R.string.settings), onBack, trailing = { SaveBadge(save) })
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            SECTIONS.forEach { s -> Pill(stringResource(s.label), section == s.id) { section = s.id } }
        }
        AnimatedContent(
            section, Modifier.weight(1f).fillMaxWidth(), label = "settings-section",
            transitionSpec = { enterRise(on) togetherWith exitFade(on) },
        ) { id ->
            when (id) {
                "models" -> ModelsSection(vm)
                "providers" -> ProvidersSection(vm, settings) { settings = it }
                "personalization" -> PersonalizationSection(settings) { settings = it }
                "memory" -> MemorySection(vm, settings) { settings = it }
                else -> AccountSection(vm, onChangeServer)
            }
        }
    }
}

@Composable
private fun SaveBadge(state: SaveState) {
    val on = LocalMotion.current
    AnimatedContent(state, label = "save-badge", transitionSpec = { enterRise(on) togetherWith exitFade(on) }) { s ->
        when (s) {
            SaveState.Idle -> Spacer(Modifier.size(1.dp))
            SaveState.Saving -> Text(stringResource(R.string.auto_saving), color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall)
            SaveState.Saved -> Text(stringResource(R.string.auto_saved), color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall)
            SaveState.Error -> Text(stringResource(R.string.auto_error), color = KoreMindColors.Danger, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun Pill(label: String, active: Boolean, onClick: () -> Unit) {
    val on = LocalMotion.current
    val bg by animateColorAsState(if (active) KoreMindColors.Raised else Color.Transparent, quickSpec(on), label = "pill-bg")
    val fg by animateColorAsState(if (active) KoreMindColors.Text else KoreMindColors.Muted, quickSpec(on), label = "pill-fg")
    Box(Modifier.heightIn(min = 40.dp).background(bg, UiShape).clickable(onClick = onClick).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text(label, color = fg, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun SectionHeader(title: String, hint: String) {
    Column(Modifier.fillMaxWidth().padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(hint, color = KoreMindColors.Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

private val CardModifier = Modifier.fillMaxWidth().background(KoreMindColors.Surface, UiShape).border(HairlineBorder, UiShape)
private val ScreenPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 32.dp)

// ---- Models ---------------------------------------------------------------------------------

@Composable
private fun ModelsSection(vm: AppViewModel) {
    val providers by vm.providers.collectAsStateWithLifecycle()
    val favorites by vm.favorites.collectAsStateWithLifecycle()
    val info = remember(providers) { providers.flatMap { p -> p.models.map { "${p.id}/${it.id}" to (it.name to p.name) } }.toMap() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item(key = "header") { SectionHeader(stringResource(R.string.section_models), stringResource(R.string.models_hint)) }
        items(favorites.toList(), key = { it }) { k ->
            Row(animateRow(LocalMotion.current).then(CardModifier).heightIn(min = 48.dp).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(info[k]?.first ?: k, maxLines = 1, style = MaterialTheme.typography.bodyMedium)
                    info[k]?.second?.let { Text(it, color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall) }
                }
                IconButton(onClick = { vm.toggleFavorite(k) }) { Icon(Icons.Filled.Star, stringResource(R.string.remove_favorite), tint = KoreMindColors.Accent) }
            }
        }
        if (favorites.isEmpty()) item(key = "empty") {
            Column(CardModifier.padding(vertical = 32.dp, horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.Star, null, tint = KoreMindColors.Muted)
                Text(stringResource(R.string.no_favorites_title), fontWeight = FontWeight.Medium)
                Text(stringResource(R.string.no_favorites), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
            }
        }
    }
}

// ---- Providers ------------------------------------------------------------------------------

@Composable
private fun ProvidersSection(vm: AppViewModel, settings: Settings?, onChange: (Settings) -> Unit) {
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<ProviderConnection>>(emptyList()) }
    var keyOpen by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val keys = remember { mutableStateMapOf<String, String>() }
    suspend fun load() { list = try { vm.api?.providers() ?: emptyList() } catch (_: Exception) { emptyList() } }
    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(ScreenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionHeader(stringResource(R.string.section_providers), stringResource(R.string.providers_hint))
        list.forEach { p ->
            val state = providerStatus(p.id, p.connected)
            val open = keyOpen == p.id
            val dot by animateColorAsState(
                when (state) { ProviderState.On -> KoreMindColors.Accent; ProviderState.Free -> KoreMindColors.Warning; ProviderState.Off -> KoreMindColors.BorderStrong },
                quickSpec(LocalMotion.current), label = "dot",
            )
            Column(CardModifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(36.dp).background(KoreMindColors.Raised, UiShape), contentAlignment = Alignment.Center) { ProviderIcon(p.id, p.name, 20.dp) }
                    Column {
                        Text(p.name, fontWeight = FontWeight.Medium, maxLines = 1)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(6.dp).background(dot, CircleShape))
                            Text(
                                stringResource(when (state) { ProviderState.On -> R.string.connected; ProviderState.Free -> R.string.free_tier; ProviderState.Off -> R.string.not_connected }),
                                color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
                if (settings != null) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SwitchRow(stringResource(R.string.use_in_picker), null, providerEnabled(settings, p.id)) { onChange(withProviderEnabled(settings, p.id, it)) }
                    if (p.supportsFreeFilter) SwitchRow(stringResource(R.string.only_free_models), stringResource(R.string.only_free_hint), freeOnly(settings, p.id)) { onChange(withFreeOnly(settings, p.id, it)) }
                }
                if ("signin" in p.methods && !p.connected) Text(stringResource(R.string.sign_in_on_web), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if ("key" in p.methods) KoreMindButton(
                        stringResource(if (open) R.string.hide_key else if (p.connected) R.string.replace_key else R.string.add_key),
                        ghost = true, onClick = { keyOpen = if (open) null else p.id },
                    )
                    if (p.connected) KoreMindButton(stringResource(R.string.disconnect), ghost = true, onClick = {
                        error = null
                        scope.launch { try { vm.api?.removeProviderKey(p.id); vm.refreshModels(); load() } catch (e: Exception) { error = e.message } }
                    })
                }
                val motion = LocalMotion.current
                AnimatedVisibility(open, enter = enterExpand(motion), exit = exitShrink(motion)) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        KoreMindField(stringResource(R.string.api_key), keys[p.id] ?: "", { keys[p.id] = it }, password = true)
                        KoreMindButton(stringResource(R.string.save_key), enabled = !keys[p.id].isNullOrBlank(), onClick = {
                            error = null
                            scope.launch {
                                try { vm.api?.setProviderKey(p.id, keys[p.id].orEmpty()); keys[p.id] = ""; keyOpen = null; vm.refreshModels(); load() }
                                catch (e: Exception) { error = e.message }
                            }
                        })
                    }
                }
            }
        }
        ErrorText(error)
    }
}

@Composable
private fun SwitchRow(label: String, hint: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (hint != null) Text(hint, color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall)
        }
        KoreMindSwitch(checked, onChange)
    }
}

// ---- Personalization ------------------------------------------------------------------------

@Composable
private fun PersonalizationSection(settings: Settings?, onChange: (Settings) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(ScreenPadding)) {
        SectionHeader(stringResource(R.string.personalization), stringResource(R.string.personalization_hint))
        if (settings == null) return@Column
        val preset = activePreset(settings.tone)
        Column(CardModifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            KoreMindField(stringResource(R.string.display_name), settings.displayName, { onChange(settings.copy(displayName = it.take(NAME_MAX))) })
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.tone_presets), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TONE_PRESETS.forEach { p -> PresetChip(stringResource(p.label), preset == p.id) { onChange(settings.copy(tone = togglePreset(settings.tone, p.id))) } }
                }
                KoreMindField(stringResource(R.string.tone_custom), if (preset != null) "" else settings.tone, { onChange(settings.copy(tone = it.take(TONE_MAX))) }, hint = stringResource(R.string.tone_hint))
            }
            Column {
                KoreMindField(stringResource(R.string.about), settings.about, { onChange(settings.copy(about = it.take(ABOUT_MAX))) }, singleLine = false, minLines = 4)
                Text("${settings.about.length}/$ABOUT_MAX", color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
            }
        }
    }
}

@Composable
private fun PresetChip(label: String, active: Boolean, onClick: () -> Unit) {
    val on = LocalMotion.current
    val border by animateColorAsState(if (active) KoreMindColors.Accent else KoreMindColors.Border, quickSpec(on), label = "chip-border")
    val bg by animateColorAsState(if (active) KoreMindColors.Accent.copy(alpha = 0.15f) else KoreMindColors.Surface, quickSpec(on), label = "chip-bg")
    val scale by animateFloatAsState(if (active) 1f else 0.98f, layoutSpec(on), label = "chip-scale")
    Box(
        Modifier.heightIn(min = 36.dp).graphicsLayer { scaleX = scale; scaleY = scale }.background(bg, RoundedCornerShape(50)).border(1.dp, border, RoundedCornerShape(50)).clickable(onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (active) KoreMindColors.Text else KoreMindColors.Muted, style = MaterialTheme.typography.labelMedium) }
}

// ---- Memory ---------------------------------------------------------------------------------

@Composable
private fun MemorySection(vm: AppViewModel, settings: Settings?, onChange: (Settings) -> Unit) {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<MemoryEntry>?>(null) }
    var editing by remember { mutableStateOf<MemoryEntry?>(null) }
    var draft by remember { mutableStateOf("") }
    suspend fun load() { entries = try { vm.api?.memory() ?: emptyList() } catch (_: Exception) { emptyList() } }
    LaunchedEffect(Unit) { load() }
    val resources = LocalContext.current.resources

    LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item(key = "header") { SectionHeader(stringResource(R.string.memory), stringResource(R.string.memory_hint)) }
        if (settings != null) item(key = "switch") {
            Row(CardModifier.heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.memory_on))
                    entries?.let { Text(resources.getQuantityString(R.plurals.memory_count, it.size, it.size), color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall) }
                }
                KoreMindSwitch(settings.memoryEnabled) { onChange(settings.copy(memoryEnabled = it)) }
            }
        }
        val list = entries ?: emptyList()
        items(list, key = { it.id }) { e ->
            Row(animateRow(LocalMotion.current).then(CardModifier).padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(e.text, Modifier.weight(1f).padding(vertical = 12.dp))
                IconButton(onClick = { editing = e; draft = e.text }) { Icon(Icons.Filled.Edit, stringResource(R.string.edit), Modifier.size(18.dp), tint = KoreMindColors.Muted) }
                IconButton(onClick = { scope.launch { try { vm.api?.deleteMemory(e.id) } catch (_: Exception) { }; load() } }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete), Modifier.size(18.dp), tint = KoreMindColors.Muted) }
            }
        }
        if (entries != null && list.isEmpty()) item(key = "empty") {
            Text(stringResource(R.string.memory_empty), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 28.dp))
        }
    }
    editing?.let { e ->
        AlertDialog(
            onDismissRequest = { editing = null }, containerColor = KoreMindColors.Raised,
            title = { Text(stringResource(R.string.edit)) },
            text = { KoreMindField(stringResource(R.string.memory), draft, { draft = it }, singleLine = false, minLines = 2) },
            confirmButton = { TextButton(onClick = { scope.launch { try { vm.api?.updateMemory(e.id, draft) } catch (_: Exception) { }; editing = null; load() } }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

// ---- Account --------------------------------------------------------------------------------

@Composable
private fun AccountSection(vm: AppViewModel, onChangeServer: () -> Unit) {
    val session by vm.session.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(ScreenPadding), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionHeader(stringResource(R.string.account), stringResource(R.string.account_hint))
        Column(CardModifier) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.signed_in_as), color = KoreMindColors.Muted)
                Text(session.email ?: "", maxLines = 1)
            }
            Box(Modifier.fillMaxWidth().size(width = 1.dp, height = 1.dp).background(KoreMindColors.Border))
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.server), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
                    Text(session.baseUrl ?: "", style = MaterialTheme.typography.bodyMedium)
                }
                Text(stringResource(R.string.change_server), color = KoreMindColors.Accent, modifier = Modifier.clickable(onClick = onChangeServer).padding(8.dp))
            }
        }
        KoreMindButton(stringResource(R.string.sign_out), ghost = true, danger = true, onClick = vm::signOut)
    }
}

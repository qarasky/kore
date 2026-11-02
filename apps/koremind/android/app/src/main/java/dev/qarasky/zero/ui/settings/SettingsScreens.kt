package dev.qarasky.zero.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.qarasky.zero.R
import dev.qarasky.zero.data.MemoryEntry
import dev.qarasky.zero.data.Settings
import dev.qarasky.zero.ui.AppViewModel
import dev.qarasky.zero.ui.BackBar
import dev.qarasky.zero.ui.ErrorText
import dev.qarasky.zero.ui.Section
import dev.qarasky.zero.ui.ZeroButton
import dev.qarasky.zero.ui.ZeroField
import dev.qarasky.zero.ui.theme.ZeroColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(vm: AppViewModel, onBack: () -> Unit, onMemory: () -> Unit, onChangeServer: () -> Unit) {
    val session by vm.session.collectAsStateWithLifecycle()
    val providers by vm.providers.collectAsStateWithLifecycle()
    val favorites by vm.favorites.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var settings by remember { mutableStateOf<Settings?>(null) }
    var saved by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val keys = remember { mutableStateMapOf<String, String>() }
    val names = providers.flatMap { p -> p.models.map { "${p.id}/${it.id}" to it.name } }.toMap()

    LaunchedEffect(Unit) { settings = try { vm.api?.settings() } catch (_: Exception) { null } }

    Column(Modifier.fillMaxSize().background(ZeroColors.Bg).statusBarsPadding().navigationBarsPadding()) {
        BackBar(stringResource(R.string.settings), onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            Section(stringResource(R.string.backend_section)) {
                Text(session.baseUrl ?: "", color = ZeroColors.Muted)
                Text(stringResource(R.string.change_server), color = ZeroColors.Accent, modifier = Modifier.clickable(onClick = onChangeServer).padding(vertical = 4.dp))
            }
            Section(stringResource(R.string.favorites_section)) {
                if (favorites.isEmpty()) Text(stringResource(R.string.no_favorites), color = ZeroColors.Muted, style = MaterialTheme.typography.bodySmall)
                favorites.forEach { k ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 40.dp).background(ZeroColors.Surface, RoundedCornerShape(6.dp)).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(names[k] ?: k, Modifier.weight(1f))
                        IconButton(onClick = { vm.toggleFavorite(k) }) { Icon(Icons.Filled.Star, stringResource(R.string.remove_favorite), tint = ZeroColors.Accent) }
                    }
                }
            }
            Section(stringResource(R.string.providers_section)) {
                providers.forEach { p ->
                    Column(Modifier.fillMaxWidth().background(ZeroColors.Surface, RoundedCornerShape(6.dp)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row { Text(p.name, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge); Text(if (p.connected) stringResource(R.string.connected) else stringResource(R.string.not_connected), color = ZeroColors.Muted, style = MaterialTheme.typography.bodySmall) }
                        ZeroField(stringResource(R.string.api_key), keys[p.id] ?: "", { keys[p.id] = it }, password = true)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ZeroButton(stringResource(R.string.save_key), enabled = !keys[p.id].isNullOrBlank(), onClick = {
                                scope.launch { try { vm.api?.setProviderKey(p.id, keys[p.id].orEmpty()); keys[p.id] = ""; vm.refreshModels(); error = null } catch (e: Exception) { error = e.message } }
                            })
                            ZeroButton(stringResource(R.string.remove_key), ghost = true, onClick = { scope.launch { try { vm.api?.removeProviderKey(p.id); vm.refreshModels() } catch (e: Exception) { error = e.message } } })
                        }
                    }
                }
                ErrorText(error)
            }
            Section(stringResource(R.string.personalization)) {
                settings?.let { s ->
                    ZeroField(stringResource(R.string.display_name), s.displayName, { settings = s.copy(displayName = it) })
                    ZeroField(stringResource(R.string.tone), s.tone, { settings = s.copy(tone = it) }, hint = stringResource(R.string.tone_hint))
                    ZeroField(stringResource(R.string.about), s.about, { settings = s.copy(about = it) }, singleLine = false, minLines = 3)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ZeroButton(stringResource(R.string.save), onClick = { scope.launch { try { settings = vm.api?.putSettings(s); saved = true; delay(1500); saved = false } catch (_: Exception) { } } })
                        if (saved) Text(stringResource(R.string.saved), color = ZeroColors.Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(ZeroColors.Surface, RoundedCornerShape(6.dp)).clickable(onClick = onMemory).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.memory), Modifier.weight(1f))
                }
            }
            Section(stringResource(R.string.account)) {
                Text(session.email ?: "", color = ZeroColors.Muted)
                ZeroButton(stringResource(R.string.sign_out), ghost = true, onClick = vm::signOut)
            }
        }
    }
}

@Composable
fun MemoryScreen(vm: AppViewModel, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<MemoryEntry>>(emptyList()) }
    var settings by remember { mutableStateOf<Settings?>(null) }
    var editing by remember { mutableStateOf<MemoryEntry?>(null) }
    var draft by remember { mutableStateOf("") }
    suspend fun load() { entries = try { vm.api?.memory() ?: emptyList() } catch (_: Exception) { emptyList() } }
    LaunchedEffect(Unit) { load(); settings = try { vm.api?.settings() } catch (_: Exception) { null } }

    Column(Modifier.fillMaxSize().background(ZeroColors.Bg).statusBarsPadding().navigationBarsPadding()) {
        BackBar(stringResource(R.string.memory), onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.memory_hint), color = ZeroColors.Muted)
            settings?.let { s ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).background(ZeroColors.Surface, RoundedCornerShape(6.dp)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.memory_on), Modifier.weight(1f))
                    Switch(s.memoryEnabled, { on -> scope.launch { try { settings = vm.api?.putSettings(s.copy(memoryEnabled = on)) } catch (_: Exception) { } } })
                }
            }
            if (entries.isEmpty()) Text(stringResource(R.string.memory_empty), color = ZeroColors.Muted, style = MaterialTheme.typography.bodySmall)
            entries.forEach { e ->
                Row(Modifier.fillMaxWidth().background(ZeroColors.Surface, RoundedCornerShape(6.dp)).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(e.text, Modifier.weight(1f).padding(vertical = 10.dp))
                    IconButton(onClick = { editing = e; draft = e.text }) { Icon(Icons.Filled.Edit, stringResource(R.string.edit), Modifier.size(18.dp), tint = ZeroColors.Muted) }
                    IconButton(onClick = { scope.launch { try { vm.api?.deleteMemory(e.id) } catch (_: Exception) { }; load() } }) { Icon(Icons.Filled.Delete, stringResource(R.string.delete), Modifier.size(18.dp), tint = ZeroColors.Muted) }
                }
            }
        }
    }
    editing?.let { e ->
        AlertDialog(
            onDismissRequest = { editing = null }, containerColor = ZeroColors.Raised,
            title = { Text(stringResource(R.string.edit)) },
            text = { ZeroField(stringResource(R.string.memory), draft, { draft = it }, singleLine = false, minLines = 2) },
            confirmButton = { TextButton(onClick = { scope.launch { try { vm.api?.updateMemory(e.id, draft) } catch (_: Exception) { }; editing = null; load() } }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { editing = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

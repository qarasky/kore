package dev.qarasky.koremind.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.qarasky.koremind.R
import dev.qarasky.koremind.data.ApiException
import dev.qarasky.koremind.ui.AppViewModel
import dev.qarasky.koremind.ui.PairUi
import dev.qarasky.koremind.ui.ErrorText
import dev.qarasky.koremind.ui.KoreMindButton
import dev.qarasky.koremind.ui.KoreMindField
import dev.qarasky.koremind.ui.chat.Wordmark
import dev.qarasky.koremind.ui.theme.Appear
import dev.qarasky.koremind.ui.theme.KoreMindColors
import kotlinx.coroutines.launch

/** "Scan QR code": pairs with the code shown on the web (Settings → Account). Shows its own progress and errors. */
@Composable
private fun ScanQrSection(vm: AppViewModel, showHint: Boolean) {
    val pair by vm.pairState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val working = pair is PairUi.Working
    val error = (pair as? PairUi.Failed)?.let { stringResource(it.message) }
    DisposableEffect(Unit) { onDispose { if (vm.pairState.value is PairUi.Failed) vm.pairHandled() } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ErrorText(error)
        KoreMindButton(
            if (working) stringResource(R.string.pair_connecting) else stringResource(R.string.scan_qr), ghost = true, enabled = !working, modifier = Modifier.fillMaxWidth(),
            onClick = { startQrScan(context, onResult = vm::startPair, onUnavailable = { vm.pairFailed(R.string.pair_scanner_unavailable) }) },
        )
        if (showHint) Text(stringResource(R.string.connect_scan_hint), style = MaterialTheme.typography.bodySmall, color = KoreMindColors.Muted)
    }
}

@Composable
fun ConnectScreen(vm: AppViewModel, onConnected: () -> Unit) {
    val session by vm.session.collectAsStateWithLifecycle()
    var value by remember { mutableStateOf(session.baseUrl ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Appear { Column(Modifier.widthIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Wordmark()
            Text(stringResource(R.string.connect_title), style = MaterialTheme.typography.titleLarge)
            KoreMindField(stringResource(R.string.backend_url), value, { value = it }, hint = stringResource(R.string.connect_hint), keyboardType = KeyboardType.Uri)
            ErrorText(error)
            KoreMindButton(if (busy) stringResource(R.string.checking) else stringResource(R.string.connect_action), enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                error = null; busy = true
                scope.launch {
                    vm.connect(value).onSuccess { onConnected() }.onFailure { error = it.message }
                    busy = false
                }
            })
            ScanQrSection(vm, showHint = true)
        } }
    }
}

@Composable
fun LoginScreen(vm: AppViewModel, onSignedIn: () -> Unit, onChangeServer: () -> Unit) {
    var setup by remember { mutableStateOf<Boolean?>(null) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val tooMany = stringResource(R.string.too_many_attempts, 1)

    LaunchedEffect(Unit) { setup = vm.setupRequired() }

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Appear { Column(Modifier.widthIn(max = 380.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Wordmark()
            Text(if (setup == true) stringResource(R.string.create_account_title) else stringResource(R.string.login_title), style = MaterialTheme.typography.titleLarge)
            if (setup == true) Text(stringResource(R.string.create_account_hint), style = MaterialTheme.typography.bodySmall, color = KoreMindColors.Muted)
            KoreMindField(stringResource(R.string.email), email, { email = it }, keyboardType = KeyboardType.Email)
            KoreMindField(stringResource(R.string.password), password, { password = it }, password = true, hint = if (setup == true) stringResource(R.string.password_hint) else null)
            ErrorText(error)
            KoreMindButton(if (setup == true) stringResource(R.string.create_account) else stringResource(R.string.sign_in), enabled = !busy && email.isNotBlank() && password.length >= 8, modifier = Modifier.fillMaxWidth(), onClick = {
                error = null; busy = true
                scope.launch {
                    vm.authenticate(email.trim(), password, setup == true).onSuccess { onSignedIn() }.onFailure {
                        error = if (it is ApiException && it.code == "rate_limited") tooMany.replace("1", "${((it.retryAfterSec ?: 60) + 59) / 60}") else it.message
                    }
                    busy = false
                }
            })
            ScanQrSection(vm, showHint = false)
            TextButton(onClick = onChangeServer) { Text(stringResource(R.string.change_server), color = KoreMindColors.Muted) }
        } }
    }
}

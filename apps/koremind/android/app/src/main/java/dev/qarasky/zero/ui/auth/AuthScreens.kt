package dev.qarasky.zero.ui.auth

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import dev.qarasky.zero.R
import dev.qarasky.zero.data.ApiException
import dev.qarasky.zero.ui.AppViewModel
import dev.qarasky.zero.ui.ErrorText
import dev.qarasky.zero.ui.ZeroButton
import dev.qarasky.zero.ui.ZeroField
import dev.qarasky.zero.ui.chat.Wordmark
import dev.qarasky.zero.ui.theme.Appear
import dev.qarasky.zero.ui.theme.ZeroColors
import kotlinx.coroutines.launch

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
            ZeroField(stringResource(R.string.backend_url), value, { value = it }, hint = stringResource(R.string.connect_hint), keyboardType = KeyboardType.Uri)
            ErrorText(error)
            ZeroButton(if (busy) stringResource(R.string.checking) else stringResource(R.string.connect_action), enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = {
                error = null; busy = true
                scope.launch {
                    vm.connect(value).onSuccess { onConnected() }.onFailure { error = it.message }
                    busy = false
                }
            })
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
            if (setup == true) Text(stringResource(R.string.create_account_hint), style = MaterialTheme.typography.bodySmall, color = ZeroColors.Muted)
            ZeroField(stringResource(R.string.email), email, { email = it }, keyboardType = KeyboardType.Email)
            ZeroField(stringResource(R.string.password), password, { password = it }, password = true, hint = if (setup == true) stringResource(R.string.password_hint) else null)
            ErrorText(error)
            ZeroButton(if (setup == true) stringResource(R.string.create_account) else stringResource(R.string.sign_in), enabled = !busy && email.isNotBlank() && password.length >= 8, modifier = Modifier.fillMaxWidth(), onClick = {
                error = null; busy = true
                scope.launch {
                    vm.authenticate(email.trim(), password, setup == true).onSuccess { onSignedIn() }.onFailure {
                        error = if (it is ApiException && it.code == "rate_limited") tooMany.replace("1", "${((it.retryAfterSec ?: 60) + 59) / 60}") else it.message
                    }
                    busy = false
                }
            })
            TextButton(onClick = onChangeServer) { Text(stringResource(R.string.change_server), color = ZeroColors.Muted) }
        } }
    }
}

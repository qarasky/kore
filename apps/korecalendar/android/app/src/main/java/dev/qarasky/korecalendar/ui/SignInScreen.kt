package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.data.SignInResult
import dev.qarasky.korecalendar.data.normalizeServerUrl
import dev.qarasky.korecalendar.ui.theme.Palette
import kotlinx.coroutines.launch

@Composable
fun SignInScreen(state: AppState.SignedOut, onSignIn: suspend (url: String, email: String, password: String) -> SignInResult) {
    var url by rememberSaveable(state.server) { mutableStateOf(state.server) }
    var email by rememberSaveable(state.email) { mutableStateOf(state.email) }
    var password by remember { mutableStateOf("") } // never saved: it must not survive a configuration change
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val badUrl = stringResource(R.string.err_bad_url)
    val badCredentials = stringResource(R.string.err_bad_credentials)
    val offline = stringResource(R.string.err_offline)
    val rateLimited = stringResource(R.string.err_rate_limited, "%s")
    val failed = stringResource(R.string.err_failed, "%s")
    val cleartext = normalizeServerUrl(url)?.cleartext == true

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(32.dp))
        Text(stringResource(R.string.sign_in_title), style = MaterialTheme.typography.headlineMedium)
        Text(
            stringResource(if (state.revoked) R.string.session_ended else R.string.sign_in_intro),
            color = if (state.revoked) Palette.warning else Palette.muted,
        )
        OutlinedTextField(
            value = url, onValueChange = { url = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.server_address)) },
            placeholder = { Text(stringResource(R.string.server_address_hint)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        if (cleartext) Text(stringResource(R.string.cleartext_warning), color = Palette.warning, style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(
            value = email, onValueChange = { email = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.email)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        OutlinedTextField(
            value = password, onValueChange = { password = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.password)) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        )
        Text(stringResource(R.string.password_not_kept), color = Palette.muted, style = MaterialTheme.typography.bodySmall)
        error?.let { Text(it, color = Palette.danger) }
        Button(
            enabled = !working && url.isNotBlank() && email.isNotBlank() && password.isNotEmpty(),
            onClick = {
                working = true
                error = null
                scope.launch {
                    val r = onSignIn(url, email, password)
                    working = false
                    error = when (r) {
                        is SignInResult.Ok -> null
                        SignInResult.BadUrl -> badUrl
                        SignInResult.BadCredentials -> badCredentials
                        is SignInResult.RateLimited -> rateLimited.replace("%s", r.message)
                        SignInResult.Offline -> offline
                        is SignInResult.Failed -> failed.replace("%s", r.message)
                    }
                    if (r is SignInResult.Ok) password = ""
                }
            },
            modifier = Modifier.fillMaxWidth().height(48.dp),
        ) { Text(stringResource(if (working) R.string.signing_in else R.string.sign_in)) }
    }
}

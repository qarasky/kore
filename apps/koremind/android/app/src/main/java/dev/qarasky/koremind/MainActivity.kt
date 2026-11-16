package dev.qarasky.koremind

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import dev.qarasky.koremind.data.UpdateEvents
import dev.qarasky.koremind.ui.AppViewModel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
import dev.qarasky.koremind.ui.KoreMindApp
import dev.qarasky.koremind.ui.theme.KoreMindTheme

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        setContent { KoreMindTheme { KoreMindApp(vm) } }
        if (savedInstanceState == null) handleLinks(intent)
        // Android's "update KoreMind?" screen for a downloaded release, shown while the app is in front.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                UpdateEvents.confirm.filterNotNull().collect { confirm ->
                    UpdateEvents.confirm.value = null
                    try { startActivity(confirm) } catch (_: Exception) { UpdateEvents.failure.value = getString(R.string.update_failed) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLinks(intent)
    }

    private fun handleLinks(intent: Intent?) {
        handlePairLink(intent)
        // Back from Kore ID in the browser: koremind://sso?ticket=... (the backend redirects there after the callback).
        val data = intent?.data ?: return
        if (data.scheme == "koremind" && data.host == "sso") { vm.handleSsoLink(data.toString()); intent.data = null }
    }

    /** A pairing QR code scanned with the camera opens koremind://pair?... and signs in. */
    private fun handlePairLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "koremind" && data.host == "pair") { vm.startPair(data.toString()); intent.data = null }
    }
}

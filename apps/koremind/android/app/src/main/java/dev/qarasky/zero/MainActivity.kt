package dev.qarasky.zero

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import dev.qarasky.zero.ui.AppViewModel
import dev.qarasky.zero.ui.ZeroApp
import dev.qarasky.zero.ui.theme.ZeroTheme

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT), navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
        setContent { ZeroTheme { ZeroApp(vm) } }
        if (savedInstanceState == null) handlePairLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePairLink(intent)
    }

    /** A pairing QR code scanned with the camera opens zero://pair?... and signs in. */
    private fun handlePairLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "zero" && data.host == "pair") { vm.startPair(data.toString()); intent.data = null }
    }
}

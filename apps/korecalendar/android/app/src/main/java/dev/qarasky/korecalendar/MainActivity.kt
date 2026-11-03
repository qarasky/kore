package dev.qarasky.korecalendar

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import dev.qarasky.korecalendar.ui.AppHolder
import dev.qarasky.korecalendar.ui.AppRoot
import dev.qarasky.korecalendar.ui.theme.KoreTheme
import dev.qarasky.korecalendar.widget.EXTRA_EVENT_ID
import dev.qarasky.korecalendar.widget.EXTRA_OCC_KEY

class MainActivity : ComponentActivity() {
    private val holder: AppHolder by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Dark only: light icons on the system bars whatever the phone's own theme is.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent { KoreTheme { AppRoot(holder.controller, holder.pendingOpen, holder::opened) } }
        openFrom(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openFrom(intent)
    }

    /** A tap on a widget row starts the app with the event it showed. */
    private fun openFrom(intent: Intent?) {
        val id = intent?.getStringExtra(EXTRA_EVENT_ID) ?: return
        holder.open(id, intent.getStringExtra(EXTRA_OCC_KEY) ?: "")
    }

    override fun onStart() {
        super.onStart()
        holder.onForeground()
    }
}

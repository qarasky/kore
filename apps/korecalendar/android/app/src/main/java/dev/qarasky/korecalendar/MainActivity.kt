package dev.qarasky.korecalendar

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import dev.qarasky.korecalendar.ui.AppHolder
import dev.qarasky.korecalendar.ui.AppRoot
import dev.qarasky.korecalendar.ui.theme.KoreTheme

class MainActivity : ComponentActivity() {
    private val holder: AppHolder by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { KoreTheme { AppRoot(holder.controller) } }
    }

    override fun onStart() {
        super.onStart()
        holder.onForeground()
    }
}

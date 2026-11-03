package dev.qarasky.korecalendar.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.qarasky.korecalendar.Graph
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Holds the process-wide controller for the activity and the event a widget tap asked to open. */
class AppHolder(app: Application) : AndroidViewModel(app) {
    val controller: AppController = Graph.get(app).controller

    private val _pendingOpen = MutableStateFlow<Pair<String, String>?>(null)

    /** (event id, occurrence key) to show, set by a tap on the widget; cleared once shown. */
    val pendingOpen: StateFlow<Pair<String, String>?> = _pendingOpen

    init {
        viewModelScope.launch {
            controller.start()
            controller.refresh()
        }
    }

    fun open(eventId: String, key: String) {
        _pendingOpen.value = eventId to key
    }

    fun opened() {
        _pendingOpen.value = null
    }

    /** The app came to the foreground: bring the copy up to date. */
    fun onForeground() {
        viewModelScope.launch { controller.refresh() }
    }
}

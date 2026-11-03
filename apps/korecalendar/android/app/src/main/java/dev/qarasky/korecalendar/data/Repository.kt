package dev.qarasky.korecalendar.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** What the screens and the widget read: the latest [Snapshot] of the local store, null until first read. */
class Repository(private val store: LocalStore) {
    private val state = MutableStateFlow<Snapshot?>(null)
    val snapshot: StateFlow<Snapshot?> = state

    suspend fun refreshFromStore() {
        state.value = store.snapshot()
    }
}

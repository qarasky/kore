package dev.qarasky.korecalendar.ui

import android.app.Application
import android.content.Context
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.AppDatabase
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.data.KeystoreSecretBox
import dev.qarasky.korecalendar.data.Prefs
import dev.qarasky.korecalendar.data.Repository
import dev.qarasky.korecalendar.data.RoomStore
import dev.qarasky.korecalendar.data.SharedPrefsKeyValue
import dev.qarasky.korecalendar.data.SignIn
import java.time.Instant
import kotlinx.coroutines.launch

/** Builds the app's object graph once per process-lifetime of the activity and holds the controller. */
class AppHolder(app: Application) : AndroidViewModel(app) {
    val controller: AppController

    init {
        val kv = SharedPrefsKeyValue(app.getSharedPreferences("korecal", Context.MODE_PRIVATE))
        val accounts = AccountStore(kv, KeystoreSecretBox())
        val store = RoomStore(AppDatabase.open(app))
        val repo = Repository(store)
        val apiFor = { url: dev.qarasky.korecalendar.data.ServerUrl, token: String? -> HttpApi(url, token) }
        controller = AppController(
            accounts = accounts,
            prefs = Prefs(kv),
            store = store,
            repo = repo,
            signInFlow = SignIn(apiFor, accounts, Build.MODEL),
            apiFor = apiFor,
            background = NoBackground,
            now = { Instant.now() },
        )
        viewModelScope.launch {
            controller.start()
            controller.refresh()
        }
    }

    /** The app came to the foreground: bring the copy up to date. */
    fun onForeground() {
        viewModelScope.launch { controller.refresh() }
    }
}

/** Replaced by the WorkManager/widget implementation (Task 11). */
internal object NoBackground : Background {
    override fun scheduleSync() = Unit
    override fun cancelSync() = Unit
    override suspend fun refreshWidgets() = Unit
}

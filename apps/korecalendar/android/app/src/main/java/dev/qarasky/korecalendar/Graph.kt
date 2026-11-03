package dev.qarasky.korecalendar

import android.app.Application
import android.content.Context
import android.os.Build
import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.AppDatabase
import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.data.KeystoreSecretBox
import dev.qarasky.korecalendar.data.Prefs
import dev.qarasky.korecalendar.data.Repository
import dev.qarasky.korecalendar.data.RoomStore
import dev.qarasky.korecalendar.data.ServerUrl
import dev.qarasky.korecalendar.data.SharedPrefsKeyValue
import dev.qarasky.korecalendar.data.SignIn
import dev.qarasky.korecalendar.sync.AndroidBackground
import dev.qarasky.korecalendar.ui.AppController
import java.time.Instant

/** The app's objects, built once per process and shared by the activity, the sync worker and the widget. */
class Graph private constructor(app: Application) {
    val kv = SharedPrefsKeyValue(app.getSharedPreferences("korecal", Context.MODE_PRIVATE))
    val accounts = AccountStore(kv, KeystoreSecretBox())
    val prefs = Prefs(kv)
    val store = RoomStore(AppDatabase.open(app))
    val repo = Repository(store)
    private val apiFor: (ServerUrl, String?) -> CalendarApi = { url, token -> HttpApi(url, token) }
    val controller = AppController(
        accounts = accounts,
        prefs = prefs,
        store = store,
        repo = repo,
        signInFlow = SignIn(apiFor, accounts, Build.MODEL),
        apiFor = apiFor,
        background = AndroidBackground(app),
        messages = dev.qarasky.korecalendar.ui.ResourceMessages(app),
        now = { Instant.now() },
    )

    companion object {
        @Volatile private var instance: Graph? = null

        fun get(context: Context): Graph = instance ?: synchronized(this) {
            instance ?: Graph(context.applicationContext as Application).also { instance = it }
        }
    }
}

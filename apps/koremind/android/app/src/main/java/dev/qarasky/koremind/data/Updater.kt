package dev.qarasky.koremind.data

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInstaller
import android.os.Build
import dev.qarasky.koremind.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Results of an install, from the system back to the app (the receiver may run before the activity is in front). */
object UpdateEvents {
    /** The system's confirmation screen, waiting for the activity to show it. */
    val confirm = MutableStateFlow<Intent?>(null)
    /** Why the last install failed, if it did. */
    val failure = MutableStateFlow<String?>(null)
}

/**
 * Updates the app from its GitHub releases: reads the manifest, downloads the APK, checks its SHA-256 and hands it
 * to Android's PackageInstaller. Android refuses an APK that is not signed with the same key as the installed app.
 * Nothing here talks to the KoreMind backend, and no credentials are sent to GitHub.
 */
class Updater(private val context: Context, private val repo: String = BuildConfig.UPDATE_REPO) {
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val dir = File(context.cacheDir, "updates")

    /** Debug builds are signed with a different key, so an update could never install over them. */
    val enabled: Boolean get() = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) == 0 && repo.isNotBlank()

    val installedVersionCode: Long get() {
        val p = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else @Suppress("DEPRECATION") p.versionCode.toLong()
    }
    val installedVersionName: String get() = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: ""

    /** The newest full release, or null when there is none with an Android manifest yet. */
    suspend fun latest(): UpdateInfo? = withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url(updateManifestUrl(repo)).build()).execute().use { r ->
            if (r.code == 404) return@use null
            if (!r.isSuccessful) throw IOException("GitHub answered ${r.code}")
            parseUpdateInfo(r.body.string(), repo) ?: throw IOException("The release manifest is not valid")
        }
    }

    /** Downloads the APK (reporting 0..1), and keeps it only if its SHA-256 matches the manifest. */
    suspend fun download(info: UpdateInfo, onProgress: (Float) -> Unit): File = withContext(Dispatchers.IO) {
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "koremind-${info.versionCode}.apk")
        client.newCall(Request.Builder().url(info.apk).build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Download failed (${r.code})")
            val total = r.body.contentLength()
            r.body.byteStream().use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val n = input.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n
                        if (total > 0) onProgress((done.toFloat() / total).coerceIn(0f, 1f))
                    }
                }
            }
        }
        if (sha256Hex(file) != info.sha256) { file.delete(); throw IOException("The download is damaged (checksum mismatch)") }
        file
    }

    /** Hands the APK to Android. The result arrives in [UpdateInstallReceiver]. */
    suspend fun install(file: File) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            // Android 12+: once KoreMind installed itself, later updates need no confirmation.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { s ->
            s.openWrite("koremind.apk", 0, file.length()).use { out -> file.inputStream().use { it.copyTo(out) }; s.fsync(out) }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
            val pi = PendingIntent.getBroadcast(context, id, Intent(context, UpdateInstallReceiver::class.java).setPackage(context.packageName), flags)
            s.commit(pi.intentSender)
        }
    }

    /** Leftovers of an earlier update (the app restarts after installing). */
    fun cleanUp() { dir.listFiles()?.forEach { it.delete() } }
}

class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                UpdateEvents.confirm.value = confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // the app is replaced and restarted
            PackageInstaller.STATUS_FAILURE_ABORTED -> UpdateEvents.failure.value = ""
            else -> UpdateEvents.failure.value = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
        }
    }
}

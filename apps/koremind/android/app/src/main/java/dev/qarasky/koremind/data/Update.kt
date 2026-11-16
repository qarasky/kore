package dev.qarasky.koremind.data

import kotlinx.serialization.Serializable
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * What a release publishes next to its APK as koremind-android.json (written by .github/workflows/android.yml).
 * The app reads it from https://github.com/<repo>/releases/latest/download/koremind-android.json, so only
 * full releases are offered, never pre-releases.
 */
@Serializable data class UpdateInfo(val version: String, val versionCode: Long, val apk: String, val sha256: String)

/** The app looks for a new release at most this often on its own; "Check for updates" in Settings always looks. */
const val UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000L

fun updateManifestUrl(repo: String) = "https://github.com/$repo/releases/latest/download/koremind-android.json"

/** Reads the manifest; null when it is malformed or points anywhere but this repo's GitHub releases. */
fun parseUpdateInfo(json: String, repo: String): UpdateInfo? {
    val info = try { KoreMindJson.decodeFromString(UpdateInfo.serializer(), json) } catch (_: Exception) { return null }
    if (info.version.isBlank() || info.versionCode <= 0) return null
    if (!SHA256.matches(info.sha256.lowercase())) return null
    if (!info.apk.startsWith("https://github.com/$repo/releases/download/")) return null
    return info.copy(sha256 = info.sha256.lowercase())
}

private val SHA256 = Regex("^[0-9a-f]{64}$")

fun isNewer(info: UpdateInfo, installedVersionCode: Long): Boolean = info.versionCode > installedVersionCode

/** Due when there was no check yet, the last one is old enough, or the clock went backwards. */
fun updateCheckDue(lastCheckMs: Long, nowMs: Long): Boolean = lastCheckMs <= 0 || nowMs < lastCheckMs || nowMs - lastCheckMs >= UPDATE_CHECK_INTERVAL_MS

/** The banner shows a newer release until it is dismissed for that release. */
fun showUpdateBanner(available: UpdateInfo?, dismissedVersionCode: Long): Boolean =
    available != null && available.versionCode > dismissedVersionCode

fun sha256Hex(input: InputStream): String {
    val md = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) }
    return md.digest().joinToString("") { "%02x".format(it) }
}

fun sha256Hex(file: File): String = file.inputStream().use(::sha256Hex)

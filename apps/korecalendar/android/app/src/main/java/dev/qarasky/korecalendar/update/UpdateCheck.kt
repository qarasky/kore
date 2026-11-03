package dev.qarasky.korecalendar.update

import dev.qarasky.korecalendar.data.KeyValue
import java.time.Duration
import java.time.Instant
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive

/** A newer app release on GitHub, with the page to download it from. */
data class UpdateInfo(val version: String, val url: String)

private fun parts(v: String): Pair<List<Int>, List<String>?> {
    val core = v.substringBefore('-')
    val pre = if ('-' in v) v.substringAfter('-').split('.') else null
    return core.split('.').map { it.toIntOrNull() ?: 0 } to pre
}

/** Semantic-version order; a pre-release (`0.3.0-rc.1`) is before its release (`0.3.0`). */
fun compareVersions(a: String, b: String): Int {
    val (an, ap) = parts(a)
    val (bn, bp) = parts(b)
    for (i in 0 until maxOf(an.size, bn.size)) {
        val c = (an.getOrElse(i) { 0 }).compareTo(bn.getOrElse(i) { 0 })
        if (c != 0) return c
    }
    if (ap == null && bp == null) return 0
    if (ap == null) return 1
    if (bp == null) return -1
    for (i in 0 until maxOf(ap.size, bp.size)) {
        val x = ap.getOrNull(i) ?: return -1
        val y = bp.getOrNull(i) ?: return 1
        val xi = x.toIntOrNull()
        val yi = y.toIntOrNull()
        val c = if (xi != null && yi != null) xi.compareTo(yi) else x.compareTo(y)
        if (c != 0) return c
    }
    return 0
}

private const val PREFIX = "android-v"

/**
 * From GitHub's list of releases: the newest `android-v*` release that is newer than [installed]. A pre-release is only offered to
 * someone running a pre-release; drafts, server releases and anything unreadable are ignored.
 */
fun newestAndroidRelease(json: String, installed: String): UpdateInfo? {
    val list = try { Json.parseToJsonElement(json) as? JsonArray } catch (_: Exception) { null } ?: return null
    val runningPre = '-' in installed
    var best: UpdateInfo? = null
    for (e in list) {
        val o = e as? JsonObject ?: continue
        val tag = o["tag_name"]?.jsonPrimitive?.content ?: continue
        if (!tag.startsWith(PREFIX)) continue
        val draft = o["draft"]?.jsonPrimitive?.boolean ?: false
        val pre = o["prerelease"]?.jsonPrimitive?.boolean ?: false
        if (draft || (pre && !runningPre)) continue
        val version = tag.removePrefix(PREFIX)
        val url = o["html_url"]?.jsonPrimitive?.content ?: continue
        if (compareVersions(version, installed) > 0 && (best == null || compareVersions(version, best.version) > 0)) best = UpdateInfo(version, url)
    }
    return best
}

/**
 * Once a day while the app is used, asks [fetch] (GitHub's release list of this repository) and remembers the answer.
 * The only request the app makes to any host other than the owner's server; it carries no identifier. A failed check is retried
 * after a couple of hours, not a day, and never raises.
 */
class UpdateChecker(private val fetch: suspend () -> String, private val kv: KeyValue, private val now: () -> Instant) {
    /** The update found earlier, if it is still newer than [installed]. */
    fun known(installed: String): UpdateInfo? {
        val v = kv.get(VERSION) ?: return null
        val url = kv.get(URL) ?: return null
        return if (compareVersions(v, installed) > 0) UpdateInfo(v, url) else null
    }

    suspend fun checkIfDue(installed: String): UpdateInfo? {
        val last = kv.get(LAST)?.let { runCatching { Instant.parse(it) }.getOrNull() }
        val wait = if (kv.get(FAILED) == "1") RETRY else DAY
        // A last-check time in the future (the clock was wrong when it was written) must not block checks.
        val since = last?.let { Duration.between(it, now()) }
        if (since != null && !since.isNegative && since < wait) return known(installed)
        return try {
            val found = newestAndroidRelease(fetch(), installed)
            kv.put(LAST, now().toString())
            kv.put(FAILED, null)
            kv.put(VERSION, found?.version)
            kv.put(URL, found?.url)
            found
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            kv.put(LAST, now().toString())
            kv.put(FAILED, "1")
            known(installed)
        }
    }

    private companion object {
        val DAY: Duration = Duration.ofHours(24)
        val RETRY: Duration = Duration.ofHours(2)
        const val LAST = "update.last"
        const val FAILED = "update.failed"
        const val VERSION = "update.version"
        const val URL = "update.url"
    }
}

private const val RELEASES_URL = "https://api.github.com/repos/qarasky/korecalendar/releases?per_page=30"

/** GitHub's release list for this repository: the app's only request to a host other than the owner's server, with no identifier. */
suspend fun fetchReleases(): String = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
    val client = okhttp3.OkHttpClient.Builder().connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS).readTimeout(20, java.util.concurrent.TimeUnit.SECONDS).build()
    val request = okhttp3.Request.Builder().url(RELEASES_URL).header("Accept", "application/vnd.github+json").header("User-Agent", "KoreCalendar").build()
    client.newCall(request).execute().use { r ->
        if (!r.isSuccessful) throw java.io.IOException("GitHub answered ${r.code}")
        r.body.string()
    }
}

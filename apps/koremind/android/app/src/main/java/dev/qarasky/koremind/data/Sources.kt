package dev.qarasky.koremind.data

import java.net.URI

// Search sources of an answer. Engines often report the same page more than once (with tracking parameters,
// a trailing slash, or simply twice), so sources are de-duplicated before they are shown.
// Kept 1:1 with shared/src/sources.ts.

private val TRACKING = Regex("^(utm_.*|ref|ref_src|fbclid|gclid|yclid|mc_cid|mc_eid|srsltid)$", RegexOption.IGNORE_CASE)

/** The same page gives the same key: host without www, no fragment, no tracking parameters, no trailing slash. */
fun sourceKey(url: String): String {
    val u = try { URI(url.trim()) } catch (_: Exception) { null }
    val host = u?.host
    if (u == null || host == null || u.scheme == null) return url.trim().lowercase()
    val params = (u.rawQuery ?: "").split('&').filter { it.isNotEmpty() }
        .map { val i = it.indexOf('='); if (i < 0) it to "" else it.substring(0, i) to it.substring(i + 1) }
        .filterNot { TRACKING.matches(it.first) }
        .sortedBy { it.first }
    val query = if (params.isEmpty()) "" else "?" + params.joinToString("&") { "${it.first}=${it.second}" }
    val path = (u.rawPath ?: "").trimEnd('/')
    return host.lowercase().removePrefix("www.") + path + query
}

private fun hostKey(url: String) = sourceKey(url).split('/', '?').first()
private fun titleKey(s: Source) = hostKey(s.url) + "|" + s.title.trim().lowercase()

/** True when [s] is a page already in [list]: same address, or the same title on the same site. */
fun hasSource(list: List<Source>, s: Source): Boolean {
    val k = sourceKey(s.url)
    val t = titleKey(s)
    return list.any { sourceKey(it.url) == k || (s.title.isNotBlank() && titleKey(it) == t) }
}

/** [list] plus [s], unless it is already there. */
fun addSource(list: List<Source>, s: Source): List<Source> = if (hasSource(list, s)) list else list + s

/** [list] without repeats, first occurrence kept, order kept. */
fun dedupeSources(list: List<Source>): List<Source> = list.fold(emptyList(), ::addSource)

/** The site a source is on, for the list: "runpod.io". */
fun sourceHost(url: String): String = try { URI(url).host?.removePrefix("www.") ?: "" } catch (_: Exception) { "" }

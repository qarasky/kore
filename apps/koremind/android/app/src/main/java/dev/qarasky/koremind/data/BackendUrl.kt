package dev.qarasky.koremind.data

import java.net.URI

/** Turns what a person types into a base URL, or null when it can't be one. */
fun normalizeBackendUrl(input: String): String? {
    val raw = input.trim()
    if (raw.isEmpty()) return null
    val withScheme = if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(raw)) raw else "http://$raw"
    val uri = try { URI(withScheme) } catch (_: Exception) { return null }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host ?: return null
    if (host.isBlank()) return null
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    val path = (uri.rawPath ?: "").trimEnd('/')
    return "$scheme://$host$port$path"
}

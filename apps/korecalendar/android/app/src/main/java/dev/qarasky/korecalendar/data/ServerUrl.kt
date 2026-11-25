package dev.qarasky.korecalendar.data

import java.net.URI

/** A server address ready to prefix API paths: no trailing slash, no `/api`. */
data class ServerUrl(val base: String, val cleartext: Boolean)

private val IPV4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")

/**
 * Turns what a person typed into a [ServerUrl], or null when it is not a usable address.
 * Without a scheme, an address on the local network (an IP, `localhost`, a single-label
 * name, `.local`, `.lan`) gets `http://` and anything else gets `https://`.
 */
fun normalizeServerUrl(input: String): ServerUrl? {
    val raw = input.trim()
    if (raw.isEmpty() || raw.any { it.isWhitespace() }) return null
    val hasScheme = raw.contains("://")
    val candidate = if (hasScheme) raw else (if (isLocalHost(hostOf(raw))) "http://" else "https://") + raw
    val uri = try {
        URI(candidate)
    } catch (_: Exception) {
        return null
    }
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (uri.userInfo != null || uri.host.isNullOrEmpty()) return null
    if (uri.port != -1 && uri.port !in 1..65535) return null
    var path = (uri.rawPath ?: "").trimEnd('/')
    if (path.endsWith("/api")) path = path.removeSuffix("/api")
    val authority = uri.rawAuthority.lowercase()
    return ServerUrl("$scheme://$authority$path", cleartext = scheme == "http")
}

private fun hostOf(raw: String): String {
    val authority = raw.substringBefore('/')
    if (authority.startsWith("[")) return authority // an IPv6 literal
    return authority.substringBefore(':').lowercase()
}

private fun isLocalHost(host: String): Boolean =
    host.startsWith("[") || IPV4.matches(host) || host == "localhost" || !host.contains('.') ||
        host.endsWith(".local") || host.endsWith(".lan")

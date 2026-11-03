package dev.qarasky.koremind.data

import java.net.URLDecoder

/** What a pairing QR code holds: a one-time code and the addresses to try, best first. */
data class PairLink(val code: String, val urls: List<String>)

/** Parses `koremind://pair?c=<code>&u=<url>&u=<url>`. Anything else, or a link with no code or no usable address, is null. */
fun parsePairLink(text: String): PairLink? {
    val raw = text.trim()
    val prefix = "koremind://pair?"
    if (!raw.startsWith(prefix, ignoreCase = true)) return null
    var code: String? = null
    val urls = mutableListOf<String>()
    for (part in raw.substring(prefix.length).split('&')) {
        val i = part.indexOf('=')
        if (i <= 0) continue
        val key = part.substring(0, i)
        val value = try { URLDecoder.decode(part.substring(i + 1), "UTF-8") } catch (_: IllegalArgumentException) { return null }
        when (key) {
            "c" -> if (code == null) code = value.trim()
            "u" -> normalizeBackendUrl(value)?.let(urls::add)
        }
    }
    return if (!code.isNullOrEmpty() && urls.isNotEmpty()) PairLink(code, urls) else null
}

sealed interface PairResult {
    data class Ok(val url: String, val auth: AuthResponse) : PairResult
    /** The code is unknown, used or expired. */
    data object Invalid : PairResult
    /** No address answered, or none could be redeemed against. */
    data object Unreachable : PairResult
}

/** Tries each address in order: the first that answers [probe] gets the code. A bad code stops everything; a network failure moves on. */
suspend fun pair(link: PairLink, probe: suspend (String) -> Boolean, redeem: suspend (url: String, code: String) -> AuthResponse): PairResult {
    for (url in link.urls) {
        if (!probe(url)) continue
        try {
            return PairResult.Ok(url, redeem(url, link.code))
        } catch (e: ApiException) {
            if (e.status != 0) return PairResult.Invalid
        }
    }
    return PairResult.Unreachable
}

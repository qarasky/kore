package dev.qarasky.koremind.data

import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Kore ID sign-in on the phone. The backend is the OIDC client; the app keeps its own PKCE verifier and trades the one-time ticket
 * that comes back in `koremind://sso?ticket=...` for a session with it. Another app that registers the same custom scheme and
 * grabs the link still cannot use the ticket without the verifier, which never leaves this app.
 */
object Pkce {
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    fun newVerifier(): String = ByteArray(48).also { SecureRandom().nextBytes(it) }.let(b64::encodeToString)
    fun challenge(verifier: String): String = b64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(StandardCharsets.US_ASCII)))
}

sealed interface SsoLink {
    data class Ticket(val ticket: String) : SsoLink
    data class Error(val code: String) : SsoLink
    data object Linked : SsoLink
}

/** Parses `koremind://sso?ticket=...`, `?error=...` or `?linked=1`. Anything else is null. */
fun parseSsoLink(text: String): SsoLink? {
    val raw = text.trim()
    val prefix = "koremind://sso?"
    if (!raw.startsWith(prefix, ignoreCase = true)) return null
    val q = HashMap<String, String>()
    for (part in raw.substring(prefix.length).split('&')) {
        val i = part.indexOf('=')
        if (i <= 0) continue
        q.putIfAbsent(part.substring(0, i), try { URLDecoder.decode(part.substring(i + 1), "UTF-8") } catch (_: IllegalArgumentException) { return null })
    }
    q["ticket"]?.takeIf { it.isNotEmpty() }?.let { return SsoLink.Ticket(it) }
    q["error"]?.takeIf { it.isNotEmpty() }?.let { return SsoLink.Error(it) }
    return if (q["linked"] == "1") SsoLink.Linked else null
}

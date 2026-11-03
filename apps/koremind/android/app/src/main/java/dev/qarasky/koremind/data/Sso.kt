package dev.qarasky.koremind.data

import androidx.annotation.StringRes
import dev.qarasky.koremind.R
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

/** What to do with a koremind://sso link, given whether someone is signed in on this phone. */
sealed interface SsoAction {
    /** A sign-in finished in the browser: trade the ticket for a session. */
    data class Exchange(val ticket: String) : SsoAction
    /** "Link Kore ID" from Settings finished: reload /me so it shows Linked. */
    data object LinkDone : SsoAction
    data class Fail(val code: String, val linking: Boolean) : SsoAction
    /** Stale or out of place (a ticket while signed in, linked=1 while signed out). */
    data object Ignore : SsoAction
}

/** A signed-in phone only ever starts linking, so a ticket arriving then is never treated as a sign-in (and vice versa). */
fun ssoAction(link: SsoLink, signedIn: Boolean): SsoAction = when (link) {
    is SsoLink.Ticket -> if (signedIn) SsoAction.Ignore else SsoAction.Exchange(link.ticket)
    SsoLink.Linked -> if (signedIn) SsoAction.LinkDone else SsoAction.Ignore
    is SsoLink.Error -> SsoAction.Fail(link.code, linking = signedIn)
}

/** The human message for an `?error=` code from the backend (same wording as the web's ssoErrorMessage). */
@StringRes fun ssoErrorMessage(code: String): Int = when (code) {
    "denied" -> R.string.sso_error_denied
    "not_allowed" -> R.string.sso_error_not_allowed
    "owner_pending" -> R.string.sso_error_owner_pending
    "account_exists" -> R.string.sso_error_account_exists
    "sub_taken" -> R.string.sso_error_sub_taken
    "already_linked" -> R.string.sso_error_already_linked
    "no_email" -> R.string.sso_error_no_email
    "unavailable" -> R.string.sso_error_unavailable
    "invalid_state" -> R.string.sso_error_invalid_state
    else -> R.string.sso_failed
}

/** Kore ID's sign-out page to open after POST /auth/logout, if the session came from a Kore ID sign-in. Only http(s) URLs. */
fun logoutBrowserUrl(r: LogoutResponse?): String? =
    r?.logoutUrl?.trim()?.takeIf { it.startsWith("https://", ignoreCase = true) || it.startsWith("http://", ignoreCase = true) }

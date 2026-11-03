package dev.qarasky.korecalendar.data

import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Sign in with Kore ID from the phone: OpenID Connect authorization code + PKCE (RFC 7636, RFC 8252).
 *
 * The app is a public client, `korecalendar-android` in Kore ID, with the private-use redirect
 * [KOREID_REDIRECT_URI]. The browser (not a WebView) signs the person in; the app trades the code for a
 * Kore ID access token, uses it once against the KoreCalendar API to create its own access token (a
 * `kcal_` token), and drops the Kore ID tokens: only the `kcal_` token is kept.
 */
const val KOREID_CLIENT_ID = "korecalendar-android"
const val KOREID_REDIRECT_URI = "dev.qarasky.korecalendar:/oauth2redirect"
const val KOREID_SCOPES = "openid profile email"

/** The one-time secrets of a sign-in in progress. */
class Pkce(val verifier: String, val state: String) {
    val challenge: String = base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    companion object {
        fun generate(random: SecureRandom = SecureRandom()) = Pkce(randomUrlSafe(random, 32), randomUrlSafe(random, 24))
    }
}

private fun randomUrlSafe(random: SecureRandom, bytes: Int) = base64Url(ByteArray(bytes).also { random.nextBytes(it) })

private fun base64Url(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)

/** Where the provider says its endpoints are (OpenID discovery). */
data class KoreIdEndpoints(val authorization: String, val token: String)

/** What the browser brought back to [KOREID_REDIRECT_URI]. */
sealed interface KoreIdRedirect {
    data class Code(val code: String) : KoreIdRedirect
    data class Denied(val error: String) : KoreIdRedirect
    data object Invalid : KoreIdRedirect
}

/** The authorization request URL to open in the browser. */
fun koreIdAuthorizationUrl(endpoints: KoreIdEndpoints, pkce: Pkce, clientId: String = KOREID_CLIENT_ID, redirectUri: String = KOREID_REDIRECT_URI): String {
    fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    val params = listOf(
        "response_type" to "code", "client_id" to clientId, "redirect_uri" to redirectUri, "scope" to KOREID_SCOPES,
        "state" to pkce.state, "code_challenge" to pkce.challenge, "code_challenge_method" to "S256",
    )
    val sep = if (endpoints.authorization.contains('?')) "&" else "?"
    return endpoints.authorization + sep + params.joinToString("&") { (k, v) -> "${enc(k)}=${enc(v)}" }
}

/**
 * Reads the redirect the browser delivered. The `state` must be the one this sign-in started with
 * (a redirect from some other sign-in, or forged by another app, is [KoreIdRedirect.Invalid]), and if the
 * provider names itself (`iss`, RFC 9207) it must be [issuer].
 */
fun parseKoreIdRedirect(url: String, pkce: Pkce, issuer: String, redirectUri: String = KOREID_REDIRECT_URI): KoreIdRedirect {
    val uri = try {
        java.net.URI(url)
    } catch (_: Exception) {
        return KoreIdRedirect.Invalid
    }
    if (!url.startsWith(redirectUri.substringBefore(':') + ":") || uri.rawPath != java.net.URI(redirectUri).rawPath) return KoreIdRedirect.Invalid
    val q = (uri.rawQuery ?: "").split('&').filter { it.contains('=') }.associate {
        val (k, v) = it.split('=', limit = 2)
        java.net.URLDecoder.decode(k, "UTF-8") to java.net.URLDecoder.decode(v, "UTF-8")
    }
    val given = q["state"] ?: return KoreIdRedirect.Invalid
    if (!MessageDigest.isEqual(given.toByteArray(), pkce.state.toByteArray())) return KoreIdRedirect.Invalid
    q["iss"]?.let { if (it != issuer.trimEnd('/')) return KoreIdRedirect.Invalid }
    q["error"]?.let { return KoreIdRedirect.Denied(it) }
    val code = q["code"]?.takeIf { it.isNotEmpty() } ?: return KoreIdRedirect.Invalid
    return KoreIdRedirect.Code(code)
}

/** The provider's side of the flow that needs the network. */
interface KoreIdProvider {
    suspend fun discover(issuer: String): KoreIdEndpoints

    /** Trades the code for the Kore ID access token. */
    suspend fun exchange(endpoints: KoreIdEndpoints, code: String, pkce: Pkce): String
}

class KoreIdException(message: String) : Exception(message)

class HttpKoreId(private val client: OkHttpClient = OkHttpClient()) : KoreIdProvider {
    override suspend fun discover(issuer: String): KoreIdEndpoints = withContext(Dispatchers.IO) {
        val base = issuer.trimEnd('/')
        val doc = getJson(Request.Builder().url("$base/.well-known/openid-configuration").build())
        // OIDC Discovery 4.3: the document must be about the issuer we asked.
        if (doc["issuer"]?.jsonPrimitive?.contentOrNull != base) throw KoreIdException("The sign-in service answered for a different address.")
        KoreIdEndpoints(
            doc["authorization_endpoint"]?.jsonPrimitive?.contentOrNull ?: throw KoreIdException("The sign-in service is incomplete."),
            doc["token_endpoint"]?.jsonPrimitive?.contentOrNull ?: throw KoreIdException("The sign-in service is incomplete."),
        )
    }

    override suspend fun exchange(endpoints: KoreIdEndpoints, code: String, pkce: Pkce): String = withContext(Dispatchers.IO) {
        val body = FormBody.Builder()
            .add("grant_type", "authorization_code").add("code", code).add("redirect_uri", KOREID_REDIRECT_URI)
            .add("client_id", KOREID_CLIENT_ID).add("code_verifier", pkce.verifier).build()
        val doc = getJson(Request.Builder().url(endpoints.token).post(body).build())
        doc["access_token"]?.jsonPrimitive?.contentOrNull ?: throw KoreIdException("The sign-in service sent no access token.")
    }

    private fun getJson(request: Request): JsonObject = try {
        client.newCall(request).execute().use { r ->
            val text = r.body.string()
            if (!r.isSuccessful) throw KoreIdException("The sign-in service refused the request (HTTP ${r.code}).")
            ApiJson.parseToJsonElement(text).jsonObject
        }
    } catch (e: IOException) {
        throw NetworkException(e.message ?: "network error", e)
    }
}

/**
 * Hands the redirect from [dev.qarasky.korecalendar.MainActivity.onNewIntent] to the sign-in that is
 * waiting for it. One sign-in at a time; a redirect nobody waits for is ignored.
 */
object KoreIdRedirects {
    @Volatile private var pending: CompletableDeferred<String>? = null

    fun expect(): CompletableDeferred<String> = CompletableDeferred<String>().also { pending?.cancel(); pending = it }

    /** @return true if a sign-in was waiting. */
    fun deliver(url: String): Boolean = pending?.complete(url) ?: false

    fun cancel() { pending?.cancel(); pending = null }
}

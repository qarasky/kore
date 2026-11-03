package dev.qarasky.korecalendar.data

sealed interface SignInResult {
    data class Ok(val account: Account, val cleartext: Boolean) : SignInResult
    data object BadUrl : SignInResult
    data class RateLimited(val message: String) : SignInResult
    data object Offline : SignInResult
    data class Failed(val message: String) : SignInResult

    /** The server offers no Kore ID sign-in. */
    data object NoKoreId : SignInResult

    /** The person closed or refused the sign-in in the browser. */
    data object Cancelled : SignInResult
}

/**
 * First run. Kore ID is the only way in: its access token is used once to create the app's own
 * access token (revocable from the web app on its own, no expiry), and only that token is kept.
 */
class SignIn(
    private val apiFor: (ServerUrl, String?) -> CalendarApi,
    private val accounts: AccountStore,
    private val deviceName: String,
    private val koreId: KoreIdProvider? = null,
) {
    /**
     * Sign in with Kore ID. [browse] opens the given authorization URL in the system browser and suspends until
     * the browser is redirected to [KOREID_REDIRECT_URI]; it returns that URL (or throws CancellationException).
     * The Kore ID access token is used once, to create the app's own access token, and is never stored.
     */
    suspend fun signInWithKoreId(rawUrl: String, browse: suspend (authorizationUrl: String) -> String): SignInResult {
        val provider = koreId ?: return SignInResult.NoKoreId
        val server = normalizeServerUrl(rawUrl) ?: return SignInResult.BadUrl
        try {
            val oidc = apiFor(server, null).authConfig().oidc ?: return SignInResult.NoKoreId
            val endpoints = provider.discover(oidc.issuer)
            val pkce = Pkce.generate()
            val back = browse(koreIdAuthorizationUrl(endpoints, pkce))
            val code = when (val r = parseKoreIdRedirect(back, pkce, oidc.issuer)) {
                is KoreIdRedirect.Code -> r.code
                is KoreIdRedirect.Denied -> return SignInResult.Cancelled
                KoreIdRedirect.Invalid -> return SignInResult.Failed("The sign-in answer did not match the request. Try again.")
            }
            val koreToken = provider.exchange(endpoints, code, pkce)
            val api = apiFor(server, koreToken)
            val user = api.me()
            val created = api.createToken("Android, $deviceName")
            val account = Account(server.base, user.id, user.email, user.timezone, created.token)
            accounts.save(account)
            return SignInResult.Ok(account, server.cleartext)
        } catch (e: ApiException) {
            return when {
                e.status == 429 || e.code == "rate_limited" -> SignInResult.RateLimited(e.message ?: "")
                else -> SignInResult.Failed(e.message ?: "")
            }
        } catch (e: KoreIdException) {
            return SignInResult.Failed(e.message ?: "")
        } catch (e: NetworkException) {
            return SignInResult.Offline
        }
    }
}

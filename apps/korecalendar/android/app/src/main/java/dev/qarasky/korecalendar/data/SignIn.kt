package dev.qarasky.korecalendar.data

sealed interface SignInResult {
    data class Ok(val account: Account, val cleartext: Boolean) : SignInResult
    data object BadUrl : SignInResult
    data object BadCredentials : SignInResult
    data class RateLimited(val message: String) : SignInResult
    data object Offline : SignInResult
    data class Failed(val message: String) : SignInResult
}

/**
 * First run. The password is used once: it signs in, the session creates the app's own
 * access token (revocable from the web app on its own, no expiry), the session is ended, and
 * only the token is kept.
 */
class SignIn(
    private val apiFor: (ServerUrl, String?) -> CalendarApi,
    private val accounts: AccountStore,
    private val deviceName: String,
) {
    suspend fun signIn(rawUrl: String, email: String, password: String): SignInResult {
        val server = normalizeServerUrl(rawUrl) ?: return SignInResult.BadUrl
        var sessionApi: CalendarApi? = null
        try {
            val session = apiFor(server, null).login(email.trim(), password)
            val api = apiFor(server, session.token)
            sessionApi = api
            val created = try {
                api.createToken("Android, $deviceName")
            } catch (e: Exception) {
                endSession(api)
                sessionApi = null
                throw e
            }
            endSession(api)
            sessionApi = null
            val account = Account(server.base, session.user.id, session.user.email, session.user.timezone, created.token)
            accounts.save(account)
            return SignInResult.Ok(account, server.cleartext)
        } catch (e: ApiException) {
            return when {
                e.status == 401 && sessionApi == null -> SignInResult.BadCredentials
                e.status == 429 || e.code == "rate_limited" -> SignInResult.RateLimited(e.message ?: "")
                else -> SignInResult.Failed(e.message ?: "")
            }
        } catch (e: NetworkException) {
            return SignInResult.Offline
        }
    }

    private suspend fun endSession(api: CalendarApi) {
        try {
            api.logout()
        } catch (_: Exception) {
            // Best effort: an unused session simply expires.
        }
    }
}

package dev.qarasky.koremind.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, val code: String, message: String, val retryAfterSec: Int? = null) : Exception(message)

private val JSON_TYPE = "application/json".toMediaType()

class KoreMindApi(val baseUrl: String, private val token: () -> String?) {
    private val client = OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    private val streamClient = client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    private fun req(method: String, path: String, body: RequestBody? = null) = Request.Builder().url(baseUrl + path)
        .apply { token()?.let { header("Authorization", "Bearer $it") } }
        .method(method, body ?: if (method == "GET" || method == "HEAD") null else "".toRequestBody(JSON_TYPE))
        .build()

    private fun fail(status: Int, text: String): Nothing {
        val e = try { KoreMindJson.parseToJsonElement(text).jsonObject["error"]?.jsonObject } catch (_: Exception) { null }
        throw ApiException(
            status, e?.get("code")?.jsonPrimitive?.content ?: "error",
            e?.get("message")?.jsonPrimitive?.content ?: "Request failed ($status)",
            e?.get("retryAfterSec")?.jsonPrimitive?.intOrNull,
        )
    }

    private suspend fun <R> call(method: String, path: String, body: RequestBody?, out: KSerializer<R>): R = withContext(Dispatchers.IO) {
        try {
            client.newCall(req(method, path, body)).execute().use { r ->
                val text = r.body.string()
                if (!r.isSuccessful) fail(r.code, text)
                KoreMindJson.decodeFromString(out, text)
            }
        } catch (e: IOException) {
            throw ApiException(0, "unreachable", "Can't reach $baseUrl. Check the address and that the server is running.")
        }
    }

    private suspend inline fun <reified R> get(path: String): R = call("GET", path, null, serializer<R>())
    private suspend inline fun <reified R> delete(path: String): R = call("DELETE", path, null, serializer<R>())
    private suspend inline fun <reified B, reified R> send(method: String, path: String, body: B): R =
        call(method, path, KoreMindJson.encodeToString(serializer<B>(), body).toRequestBody(JSON_TYPE), serializer<R>())

    @kotlinx.serialization.Serializable data class Ok(val ok: Boolean = true)

    suspend fun health(): Health = get("/health")
    suspend fun logout(): LogoutResponse = call("POST", "/auth/logout", null, serializer())
    suspend fun me(): User = get("/me")
    /** Kore ID: the URL to open in the browser. [challenge] is the PKCE challenge of a verifier kept on the phone.
     *  Sent while signed in (with the bearer token) it links Kore ID to this account instead of signing in. */
    suspend fun ssoStart(challenge: String): SsoStartResponse = send("POST", "/auth/oidc/start", SsoStartBody(challenge, "android"))
    suspend fun ssoExchange(ticket: String, verifier: String): AuthResponse = send("POST", "/auth/oidc/exchange", SsoExchangeBody(ticket, verifier))
    suspend fun models(): List<ProviderInfo> = get("/models")
    suspend fun providers(): List<ProviderConnection> = get("/providers")
    suspend fun favorites(): List<String> = get("/favorites")
    suspend fun setFavorites(keys: List<String>): List<String> = send("PUT", "/favorites", keys)
    suspend fun setProviderKey(id: String, key: String): Ok = send("PUT", "/providers/$id/key", KeyBody(key))
    suspend fun removeProviderKey(id: String): Ok = delete("/providers/$id/key")
    suspend fun chats(): List<ChatSummary> = get("/chats")
    suspend fun createChat(): ChatSummary = call("POST", "/chats", null, serializer())
    suspend fun chat(id: String): ChatDetail = get("/chats/$id")
    suspend fun deleteChat(id: String): Ok = delete("/chats/$id")
    suspend fun abort(id: String): Ok = call("POST", "/chats/$id/abort", null, serializer())
    suspend fun memory(): List<MemoryEntry> = get("/memory")
    suspend fun updateMemory(id: String, text: String): Ok = send("PUT", "/memory/$id", TextBody(text))
    suspend fun deleteMemory(id: String): Ok = delete("/memory/$id")
    suspend fun settings(): Settings = get("/settings")
    suspend fun putSettings(s: Settings): Settings = send("PUT", "/settings", s)
    /** Answers the assistant's request to use another chat's notes. */
    suspend fun answerApproval(chatId: String, approvalId: String, allow: Boolean): Ok = send("POST", "/chats/$chatId/approvals/$approvalId", ApprovalAnswer(allow))
    /** Trades a scanned pairing code for a signed-in session. No token needed. */
    suspend fun redeemPair(code: String): AuthResponse = send("POST", "/auth/pair/redeem", PairCodeBody(code))
    /** A health check that gives up after 3 s, for trying several addresses in a row. */
    suspend fun healthQuick(): Health = withContext(Dispatchers.IO) {
        try {
            client.newBuilder().callTimeout(3, TimeUnit.SECONDS).build().newCall(req("GET", "/health")).execute().use { r ->
                val text = r.body.string()
                if (!r.isSuccessful) fail(r.code, text)
                KoreMindJson.decodeFromString(Health.serializer(), text)
            }
        } catch (e: IOException) {
            throw ApiException(0, "unreachable", "Can't reach $baseUrl.")
        }
    }

    suspend fun upload(name: String, mime: String, bytes: ByteArray): Attachment {
        val form = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", name, bytes.toRequestBody(mime.toMediaType())).build()
        return call("POST", "/uploads", form, serializer())
    }

    /** Streams a reply. Network failures arrive as a single Error event instead of an exception. */
    fun send(chatId: String, body: SendMessageRequest): Flow<StreamEvent> = flow {
        val call = streamClient.newCall(req("POST", "/chats/$chatId/messages", KoreMindJson.encodeToString(SendMessageRequest.serializer(), body).toRequestBody(JSON_TYPE)))
        try {
            val resp = withContext(Dispatchers.IO) { call.execute() }
            resp.use { r ->
                if (!r.isSuccessful) {
                    val msg = try { KoreMindJson.parseToJsonElement(r.body.string()).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content } catch (_: Exception) { null }
                    emit(StreamEvent.Error("engine", msg ?: "Request failed (${r.code})"))
                    return@flow
                }
                val src = r.body.source()
                val parser = SseParser()
                val buf = ByteArray(4096)
                while (true) {
                    val n = withContext(Dispatchers.IO) { src.read(buf) }
                    if (n < 0) break
                    for (ev in parser.feed(buf.copyOf(n))) emit(ev)
                }
            }
        } catch (e: CancellationException) {
            call.cancel(); throw e
        } catch (e: IOException) {
            emit(StreamEvent.Error(if (call.isCanceled()) "aborted" else "engine", if (call.isCanceled()) "Stopped" else "The connection dropped."))
        }
    }
}

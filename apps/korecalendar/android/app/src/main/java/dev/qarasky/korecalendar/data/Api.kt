package dev.qarasky.korecalendar.data

import dev.qarasky.korecalendar.BuildConfig
import java.io.IOException
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** The server answered with an error (a stable `code` from the API, or `bad_response`). */
class ApiException(val status: Int, val code: String, message: String) : Exception(message)

/** The server could not be reached or the connection broke. */
class NetworkException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** One write the planner decided on: [path] already carries its (encoded) query. */
data class WriteRequest(val method: String, val path: String, val body: JsonObject?, val ifMatch: Int?, val idempotencyKey: String?)

/** The series after a write, the series a "this and following" edit split off, and the changed occurrences a schedule change reset. */
data class WriteResult(val event: Event, val created: Event?, val dropped: List<String>)

/** The public REST API, as far as the app uses it. */
interface CalendarApi {
    suspend fun authConfig(): AuthConfig
    suspend fun createToken(name: String): TokenCreated
    suspend fun logout()
    suspend fun me(): User
    suspend fun calendars(): List<Calendar>
    suspend fun occurrences(from: Instant, to: Instant, q: String? = null): List<Occurrence>
    suspend fun changes(since: Long): ChangeSet
    suspend fun event(id: String): Event
    suspend fun write(request: WriteRequest): WriteResult
    suspend fun restoreEvent(id: String): Event
}

private val defaultClient: OkHttpClient by lazy {
    OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .build()
}

private val JSON_TYPE = "application/json".toMediaType()

class HttpApi(
    private val server: ServerUrl,
    private val token: String?,
    private val client: OkHttpClient = defaultClient,
) : CalendarApi {

    override suspend fun authConfig(): AuthConfig = send("GET", "/api/auth/config", null, AuthConfig.serializer())

    override suspend fun createToken(name: String): TokenCreated =
        send("POST", "/api/tokens", body(JsonObject(mapOf("name" to JsonPrimitive(name)))), TokenCreated.serializer())

    override suspend fun logout() {
        send<Unit>("POST", "/api/logout", null, null)
    }

    override suspend fun me(): User = send("GET", "/api/me", null, User.serializer())

    override suspend fun calendars(): List<Calendar> = send("GET", "/api/calendars", null, ListSerializer(Calendar.serializer()))

    override suspend fun occurrences(from: Instant, to: Instant, q: String?): List<Occurrence> =
        send(
            "GET",
            "/api/occurrences",
            null,
            ListSerializer(Occurrence.serializer()),
            query = listOf("from" to from.truncatedTo(ChronoUnit.SECONDS).toString(), "to" to to.truncatedTo(ChronoUnit.SECONDS).toString()) + listOfNotNull(q?.let { "q" to it }),
        )

    override suspend fun changes(since: Long): ChangeSet =
        send("GET", "/api/changes", null, ChangeSet.serializer(), query = listOf("since" to since.toString()))

    override suspend fun event(id: String): Event = send("GET", "/api/events/$id", null, Event.serializer())

    override suspend fun write(request: WriteRequest): WriteResult {
        val headers = listOfNotNull(
            request.ifMatch?.let { "If-Match" to "\"$it\"" },
            request.idempotencyKey?.let { "Idempotency-Key" to it },
        )
        val answer = send(request.method, request.path, request.body?.let { body(it) }, JsonObject.serializer(), headers = headers)
        return try {
            WriteResult(
                event = ApiJson.decodeFromJsonElement(Event.serializer(), answer),
                created = (answer["created"] as? JsonObject)?.let { ApiJson.decodeFromJsonElement(Event.serializer(), it) },
                dropped = (answer["dropped_overrides"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList(),
            )
        } catch (e: Exception) {
            throw ApiException(200, "bad_response", "The server sent an answer the app does not understand.")
        }
    }

    override suspend fun restoreEvent(id: String): Event = send("POST", "/api/events/$id/restore", null, Event.serializer())

    private fun body(o: JsonObject) = ApiJson.encodeToString(JsonObject.serializer(), o).toRequestBody(JSON_TYPE)

    private suspend fun <T> send(
        method: String,
        path: String,
        body: okhttp3.RequestBody?,
        into: DeserializationStrategy<T>?,
        query: List<Pair<String, String>> = emptyList(),
        headers: List<Pair<String, String>> = emptyList(),
    ): T = withContext(Dispatchers.IO) {
        val url = (server.base + path).toHttpUrl().newBuilder().apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        val request = Request.Builder().url(url).method(method, body ?: if (method == "POST") "".toRequestBody(JSON_TYPE) else null)
            .header("Accept", "application/json")
            .header("User-Agent", "KoreCalendar-Android/${BuildConfig.VERSION_NAME}")
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .build()
        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            throw NetworkException(e.message ?: "network error", e)
        }
        response.use { r ->
            val text = try {
                r.body.string()
            } catch (e: IOException) {
                throw NetworkException(e.message ?: "network error", e)
            }
            if (!r.isSuccessful) throw errorOf(r.code, text)
            if (into == null) {
                @Suppress("UNCHECKED_CAST")
                return@withContext Unit as T
            }
            try {
                ApiJson.decodeFromString(into, text)
            } catch (e: Exception) {
                throw ApiException(r.code, "bad_response", "The server sent an answer the app does not understand.")
            }
        }
    }

    private fun errorOf(status: Int, text: String): ApiException = try {
        val err = ApiJson.parseToJsonElement(text).jsonObject["error"]!!.jsonObject
        ApiException(status, err["code"]!!.jsonPrimitive.content, err["message"]?.jsonPrimitive?.contentOrNull ?: "")
    } catch (e: Exception) {
        ApiException(status, "bad_response", "Unexpected answer from the server (HTTP $status).")
    }
}

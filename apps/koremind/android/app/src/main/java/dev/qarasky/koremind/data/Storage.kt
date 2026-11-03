package dev.qarasky.koremind.data

import android.content.Context
import kotlinx.serialization.builtins.ListSerializer
import java.io.File

/** Small on-device state: where the server is, who is signed in, and the chosen model. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("koremind", Context.MODE_PRIVATE)
    var baseUrl: String? get() = sp.getString("baseUrl", null); set(v) = sp.edit().putString("baseUrl", v).apply()
    var token: String? get() = sp.getString("token", null); set(v) = sp.edit().putString("token", v).apply()
    var email: String? get() = sp.getString("email", null); set(v) = sp.edit().putString("email", v).apply()
    var providerId: String? get() = sp.getString("providerId", null); set(v) = sp.edit().putString("providerId", v).apply()
    var modelId: String? get() = sp.getString("modelId", null); set(v) = sp.edit().putString("modelId", v).apply()
    var thinking: String? get() = sp.getString("thinking", null); set(v) = sp.edit().putString("thinking", v).apply()
    /** PKCE verifier of a Kore ID sign-in in progress; kept across the browser round trip (the process may be killed meanwhile). */
    var ssoVerifier: String? get() = sp.getString("ssoVerifier", null); set(v) = sp.edit().putString("ssoVerifier", v).apply()
    fun signOut() = sp.edit().remove("token").remove("email").apply()
}

/** Recent chats and messages cached as JSON so the app shows something before the network answers. */
class Cache(context: Context) {
    private val dir = File(context.filesDir, "cache").apply { mkdirs() }
    private val chatsSer = ListSerializer(ChatSummary.serializer())
    private val msgsSer = ListSerializer(ChatMessage.serializer())

    fun chats(): List<ChatSummary> = read("chats.json") { KoreMindJson.decodeFromString(chatsSer, it) } ?: emptyList()
    fun saveChats(v: List<ChatSummary>) = write("chats.json", KoreMindJson.encodeToString(chatsSer, v))
    fun messages(id: String): List<ChatMessage> = read("chat_${safe(id)}.json") { KoreMindJson.decodeFromString(msgsSer, it) } ?: emptyList()
    fun saveMessages(id: String, v: List<ChatMessage>) = write("chat_${safe(id)}.json", KoreMindJson.encodeToString(msgsSer, v.takeLast(200)))
    fun forget(id: String) { File(dir, "chat_${safe(id)}.json").delete() }
    fun clear() { dir.listFiles()?.forEach { it.delete() } }

    private fun safe(id: String) = id.filter { it.isLetterOrDigit() || it == '-' }
    private fun <T> read(name: String, parse: (String) -> T): T? = try { File(dir, name).takeIf { it.exists() }?.readText()?.let(parse) } catch (_: Exception) { null }
    private fun write(name: String, text: String) { try { File(dir, name).writeText(text) } catch (_: Exception) { } }
}

package dev.qarasky.korecalendar.data

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small string storage: SharedPreferences on the phone, a map in tests. */
interface KeyValue {
    fun get(k: String): String?
    fun put(k: String, v: String?)
}

class SharedPrefsKeyValue(private val prefs: SharedPreferences) : KeyValue {
    override fun get(k: String): String? = prefs.getString(k, null)
    override fun put(k: String, v: String?) {
        prefs.edit().apply { if (v == null) remove(k) else putString(k, v) }.apply()
    }
}

/** Seals a secret so that only this app on this phone can open it. */
interface SecretBox {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

/** AES-256-GCM with a key that lives in the Android Keystore and never leaves it. */
class KeystoreSecretBox(private val alias: String = "korecal-token") : SecretBox {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        return c.iv + c.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        require(sealed.size > IV_BYTES) { "too short" }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_BYTES))
        return c.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    }

    private companion object {
        const val IV_BYTES = 12
    }
}

/** Who is signed in, and the app's access token (sealed). The password is never kept. */
data class Account(val serverUrl: String, val userId: String, val email: String, val timezone: String, val token: String)

class AccountStore(private val kv: KeyValue, private val box: SecretBox) {
    fun save(a: Account) {
        kv.put(SERVER, a.serverUrl)
        kv.put(USER, a.userId)
        kv.put(EMAIL, a.email)
        kv.put(TZ, a.timezone)
        kv.put(TOKEN, Base64.getEncoder().encodeToString(box.seal(a.token.toByteArray())))
        kv.put(REVOKED, null)
    }

    /** The server refused the token (revoked): the person must sign in again. The account's details stay for the form. */
    fun markRevoked() = kv.put(REVOKED, "1")

    fun isRevoked(): Boolean = kv.get(REVOKED) == "1"

    /** The account, or null when none is saved or its token can no longer be opened (then it is forgotten). */
    fun load(): Account? {
        val server = kv.get(SERVER) ?: return null
        val sealed = kv.get(TOKEN) ?: return null
        val token = try {
            String(box.open(Base64.getDecoder().decode(sealed)))
        } catch (_: Exception) {
            clear()
            return null
        }
        return Account(server, kv.get(USER) ?: "", kv.get(EMAIL) ?: "", kv.get(TZ) ?: "UTC", token)
    }

    fun clear() = listOf(SERVER, USER, EMAIL, TZ, TOKEN, REVOKED).forEach { kv.put(it, null) }

    private companion object {
        const val SERVER = "account.server"
        const val USER = "account.userId"
        const val EMAIL = "account.email"
        const val TZ = "account.timezone"
        const val TOKEN = "account.token"
        const val REVOKED = "account.revoked"
    }
}

/** Display choices kept on the phone (like the web app's cookies). */
class Prefs(private val kv: KeyValue) {
    var clock24: Boolean
        get() = kv.get(CLOCK) != "12"
        set(v) = kv.put(CLOCK, if (v) "24" else "12")

    var hiddenCalendars: Set<String>
        get() = kv.get(HIDDEN)?.split(',')?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()
        set(v) = kv.put(HIDDEN, v.sorted().joinToString(","))

    var view: dev.qarasky.korecalendar.views.View
        get() = dev.qarasky.korecalendar.views.View.parse(kv.get(VIEW)) ?: dev.qarasky.korecalendar.views.View.Agenda
        set(v) = kv.put(VIEW, v.wire)

    var weekStart: dev.qarasky.korecalendar.views.WeekStart
        get() = dev.qarasky.korecalendar.views.WeekStart.parse(kv.get(WEEK_START)) ?: dev.qarasky.korecalendar.views.WeekStart.Mon
        set(v) = kv.put(WEEK_START, v.wire)

    /** The daily check for a newer app release (on by default). */
    var updateCheck: Boolean
        get() = kv.get(UPDATE_CHECK) != "off"
        set(v) = kv.put(UPDATE_CHECK, if (v) "on" else "off")

    /** The notification permission has been asked once: the app does not nag, Settings shows the state. */
    var notificationsAsked: Boolean
        get() = kv.get(NOTIF_ASKED) == "1"
        set(v) = kv.put(NOTIF_ASKED, if (v) "1" else null)

    private companion object {
        const val UPDATE_CHECK = "prefs.updatecheck"
        const val NOTIF_ASKED = "prefs.notifasked"
        const val VIEW = "prefs.view"
        const val WEEK_START = "prefs.weekstart"
        const val CLOCK = "prefs.clock"
        const val HIDDEN = "prefs.hidden"
    }
}

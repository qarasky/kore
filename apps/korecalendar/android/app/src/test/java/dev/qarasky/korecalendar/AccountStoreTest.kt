package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Account
import dev.qarasky.korecalendar.data.AccountStore
import dev.qarasky.korecalendar.data.KeyValue
import dev.qarasky.korecalendar.data.Prefs
import dev.qarasky.korecalendar.data.SecretBox
import java.security.GeneralSecurityException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MapKeyValue : KeyValue {
    val map = mutableMapOf<String, String>()
    override fun get(k: String): String? = map[k]
    override fun put(k: String, v: String?) { if (v == null) map.remove(k) else map[k] = v }
}

/** Not encryption: reverses the bytes behind a marker, and refuses anything else. */
class ReversingBox : SecretBox {
    override fun seal(plain: ByteArray): ByteArray = "BOX".toByteArray() + plain.reversedArray()
    override fun open(sealed: ByteArray): ByteArray {
        if (sealed.size < 3 || String(sealed.copyOfRange(0, 3)) != "BOX") throw GeneralSecurityException("not sealed by this box")
        return sealed.copyOfRange(3, sealed.size).reversedArray()
    }
}

class AccountStoreTest {
    private val kv = MapKeyValue()
    private val store = AccountStore(kv, ReversingBox())
    private val account = Account("https://cal.example.com", "u1", "me@example.com", "Europe/Berlin", "kcal_supersecrettoken")

    @Test fun roundTrips() {
        assertNull(store.load())
        store.save(account)
        assertEquals(account, store.load())
    }

    @Test fun theTokenIsNeverStoredInTheClear() {
        store.save(account)
        assertTrue(kv.map.values.none { it.contains("kcal_supersecrettoken") || it.contains("supersecret") })
        assertTrue(kv.map.values.none { it.contains("owner-password") })
    }

    @Test fun anUnreadableTokenMeansSignedOutAndIsCleared() {
        store.save(account)
        kv.put("account.token", java.util.Base64.getEncoder().encodeToString("garbage".toByteArray()))
        assertNull(store.load())
        assertTrue(kv.map.keys.none { it.startsWith("account.") })
    }

    @Test fun clearForgetsTheAccount() {
        store.save(account)
        store.clear()
        assertNull(store.load())
    }

    @Test fun prefsDefaultAndPersist() {
        val prefs = Prefs(kv)
        assertTrue(prefs.clock24)
        assertTrue(prefs.hiddenCalendars.isEmpty())
        prefs.clock24 = false
        prefs.hiddenCalendars = setOf("c2", "c1")
        val again = Prefs(kv)
        assertFalse(again.clock24)
        assertEquals(setOf("c1", "c2"), again.hiddenCalendars)
    }

    @Test fun theZoneIsReadWithoutOpeningTheToken() {
        val kv = MapKeyValue()
        val box = object : SecretBox {
            var opened = 0
            override fun seal(plain: ByteArray) = plain
            override fun open(sealed: ByteArray): ByteArray { opened++; return sealed }
        }
        val store = AccountStore(kv, box)
        assertEquals(null, store.timezone())
        store.save(Account("https://cal.example.com", "u1", "me@example.com", "Europe/Berlin", "kcal_x"))
        assertEquals("Europe/Berlin", store.timezone())
        assertEquals(0, box.opened)
    }
}

package dev.qarasky.korecalendar

import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.qarasky.korecalendar.data.KeystoreSecretBox
import java.security.GeneralSecurityException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecretBoxTest {
    private val box = KeystoreSecretBox("korecal-test-key")
    private val secret = "kcal_0123456789abcdef".toByteArray()

    @Test fun sealThenOpenReturnsTheSecret() {
        assertArrayEquals(secret, box.open(box.seal(secret)))
    }

    @Test fun twoSealsOfTheSameSecretDiffer() {
        assertFalse(box.seal(secret).contentEquals(box.seal(secret)))
    }

    @Test fun theSealedBytesDoNotContainTheSecret() {
        assertFalse(String(box.seal(secret), Charsets.ISO_8859_1).contains("kcal_"))
    }

    @Test fun aTamperedBlobIsRefused() {
        val sealed = box.seal(secret)
        sealed[sealed.size - 1] = (sealed[sealed.size - 1].toInt() xor 1).toByte()
        assertThrows(GeneralSecurityException::class.java) { box.open(sealed) }
    }
}

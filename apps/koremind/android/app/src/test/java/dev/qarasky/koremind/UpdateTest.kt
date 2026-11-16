package dev.qarasky.koremind

import dev.qarasky.koremind.data.UPDATE_CHECK_INTERVAL_MS
import dev.qarasky.koremind.data.UpdateInfo
import dev.qarasky.koremind.data.isNewer
import dev.qarasky.koremind.data.parseUpdateInfo
import dev.qarasky.koremind.data.sha256Hex
import dev.qarasky.koremind.data.showUpdateBanner
import dev.qarasky.koremind.data.updateCheckDue
import dev.qarasky.koremind.data.updateManifestUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateTest {
    private val repo = "qarasky/koremind"
    private val sha = "a".repeat(64)
    private fun manifest(apk: String = "https://github.com/$repo/releases/download/v0.2.0/koremind-android-0.2.0.apk", sha256: String = sha, code: Long = 20099) =
        """{"version":"0.2.0","versionCode":$code,"apk":"$apk","sha256":"$sha256"}"""

    @Test fun `the manifest is read from the latest full release`() {
        assertEquals("https://github.com/qarasky/koremind/releases/latest/download/koremind-android.json", updateManifestUrl(repo))
    }

    @Test fun `a valid manifest parses`() {
        assertEquals(UpdateInfo("0.2.0", 20099, "https://github.com/$repo/releases/download/v0.2.0/koremind-android-0.2.0.apk", sha), parseUpdateInfo(manifest(), repo))
        assertEquals(sha, parseUpdateInfo(manifest(sha256 = "A".repeat(64)), repo)!!.sha256)
    }

    @Test fun `an apk from anywhere but this repo's releases is refused`() {
        assertNull(parseUpdateInfo(manifest(apk = "https://evil.example/koremind.apk"), repo))
        assertNull(parseUpdateInfo(manifest(apk = "http://github.com/$repo/releases/download/v0.2.0/x.apk"), repo))
        assertNull(parseUpdateInfo(manifest(apk = "https://github.com/someone/else/releases/download/v0.2.0/x.apk"), repo))
    }

    @Test fun `a broken manifest is refused`() {
        assertNull(parseUpdateInfo("not json", repo))
        assertNull(parseUpdateInfo(manifest(sha256 = "abc"), repo))
        assertNull(parseUpdateInfo(manifest(code = 0), repo))
    }

    @Test fun `only a higher version code is an update`() {
        val info = parseUpdateInfo(manifest(), repo)!!
        assertTrue(isNewer(info, 10099))
        assertFalse(isNewer(info, 20099))
        assertFalse(isNewer(info, 30000))
    }

    @Test fun `checks run every few hours and after the clock goes back`() {
        assertTrue(updateCheckDue(0, 1_000))
        assertFalse(updateCheckDue(1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS - 1))
        assertTrue(updateCheckDue(1_000, 1_000 + UPDATE_CHECK_INTERVAL_MS))
        assertTrue(updateCheckDue(5_000, 1_000))
    }

    @Test fun `a dismissed release hides the banner until a newer one`() {
        val info = parseUpdateInfo(manifest(), repo)!!
        assertTrue(showUpdateBanner(info, 0))
        assertFalse(showUpdateBanner(info, 20099))
        assertTrue(showUpdateBanner(info.copy(versionCode = 20100), 20099))
        assertFalse(showUpdateBanner(null, 0))
    }

    @Test fun `sha256 matches the known digest`() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc".byteInputStream()))
        assertNotNull(sha256Hex("".byteInputStream()))
    }
}

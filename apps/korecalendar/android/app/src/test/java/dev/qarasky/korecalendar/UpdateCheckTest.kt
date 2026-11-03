package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.update.UpdateChecker
import dev.qarasky.korecalendar.update.UpdateInfo
import dev.qarasky.korecalendar.update.compareVersions
import dev.qarasky.korecalendar.update.newestAndroidRelease
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckTest {
    private fun rel(tag: String, pre: Boolean = false, draft: Boolean = false) =
        """{"tag_name":"$tag","html_url":"https://github.com/qarasky/korecalendar/releases/tag/$tag","prerelease":$pre,"draft":$draft}"""
    private fun list(vararg r: String) = "[" + r.joinToString(",") + "]"

    @Test fun versionsCompareAsNumbersAndAReleaseCandidateIsBeforeItsRelease() {
        assertTrue(compareVersions("0.10.0", "0.9.0") > 0)
        assertTrue(compareVersions("1.0.0", "0.99.99") > 0)
        assertTrue(compareVersions("0.3.0-rc.1", "0.3.0") < 0)
        assertTrue(compareVersions("0.3.0-rc.2", "0.3.0-rc.10") < 0)
        assertEquals(0, compareVersions("0.3.0", "0.3.0"))
        assertTrue(compareVersions("0.3.0-rc.1", "0.2.9") > 0)
    }

    @Test fun theNewestAndroidReleaseThatIsNewerThanTheInstalledOneIsOffered() {
        val json = list(rel("v0.9.0"), rel("android-v0.3.0"), rel("android-v0.2.0"), rel("android-v0.4.0-rc.1", pre = true), rel("android-v0.5.0", draft = true))
        assertEquals(UpdateInfo("0.3.0", "https://github.com/qarasky/korecalendar/releases/tag/android-v0.3.0"), newestAndroidRelease(json, "0.2.0"))
    }

    @Test fun nothingIsOfferedWhenTheInstalledVersionIsTheNewest() {
        assertNull(newestAndroidRelease(list(rel("android-v0.3.0"), rel("android-v0.2.0")), "0.3.0"))
        assertNull(newestAndroidRelease(list(rel("v1.0.0")), "0.1.0")) // a server release is not an app release
        assertNull(newestAndroidRelease("[]", "0.1.0"))
    }

    @Test fun aPreReleaseIsOfferedOnlyToSomeoneRunningOne() {
        val json = list(rel("android-v0.3.0-rc.1", pre = true), rel("android-v0.2.0"))
        assertNull(newestAndroidRelease(json, "0.2.0"))
        assertEquals("0.3.0-rc.1", newestAndroidRelease(json, "0.3.0-rc.0")?.version)
    }

    @Test fun garbageIsNotAnUpdate() {
        assertNull(newestAndroidRelease("not json", "0.1.0"))
        assertNull(newestAndroidRelease("""{"message":"rate limited"}""", "0.1.0"))
    }

    // --- once a day

    private class Memory : dev.qarasky.korecalendar.data.KeyValue {
        val m = HashMap<String, String?>()
        override fun get(k: String) = m[k]
        override fun put(k: String, v: String?) { m[k] = v }
    }

    @Test fun itAsksOnceADayAndRemembersTheAnswer() = runTest {
        var calls = 0
        val kv = Memory()
        var now = Instant.parse("2026-11-04T10:00:00Z")
        val checker = UpdateChecker({ calls++; list(rel("android-v0.3.0")) }, kv) { now }
        assertEquals("0.3.0", checker.checkIfDue("0.2.0")?.version)
        now = now.plusSeconds(3600)
        assertEquals("0.3.0", checker.checkIfDue("0.2.0")?.version) // remembered, not asked again
        assertEquals(1, calls)
        now = now.plusSeconds(24 * 3600)
        checker.checkIfDue("0.2.0")
        assertEquals(2, calls)
    }

    @Test fun anInstalledUpdateClearsTheNotice() = runTest {
        val kv = Memory()
        val checker = UpdateChecker({ list(rel("android-v0.3.0")) }, kv) { Instant.parse("2026-11-04T10:00:00Z") }
        checker.checkIfDue("0.2.0")
        assertNull(checker.known("0.3.0"))
    }

    @Test fun aFailedCheckIsRetriedLaterAndNeverBreaksAnything() = runTest {
        var fail = true
        var calls = 0
        var now = Instant.parse("2026-11-04T10:00:00Z")
        val checker = UpdateChecker({ calls++; if (fail) throw IOException("down") else list(rel("android-v0.3.0")) }, Memory()) { now }
        assertNull(checker.checkIfDue("0.2.0"))
        fail = false
        now = now.plusSeconds(2 * 3600) // two hours later: the failure does not wait a whole day
        assertEquals("0.3.0", checker.checkIfDue("0.2.0")?.version)
        assertEquals(2, calls)
    }

    @Test fun aLastCheckTimeInTheFutureDoesNotBlockTheCheck() = runTest {
        var calls = 0
        val kv = Memory()
        kv.put("update.last", "2026-12-01T10:00:00Z") // the clock was wrong when it was written
        val checker = UpdateChecker({ calls++; list(rel("android-v0.3.0")) }, kv) { Instant.parse("2026-11-04T10:00:00Z") }
        assertEquals("0.3.0", checker.checkIfDue("0.2.0")?.version)
        assertEquals(1, calls)
    }

    @Test fun aCancelledCheckDoesNotCountAsDone() = runTest {
        val kv = Memory()
        val checker = UpdateChecker({ throw kotlinx.coroutines.CancellationException("stopped") }, kv) { Instant.parse("2026-11-04T10:00:00Z") }
        try { checker.checkIfDue("0.2.0") } catch (_: kotlinx.coroutines.CancellationException) {}
        assertNull(kv.get("update.last"))
    }
}

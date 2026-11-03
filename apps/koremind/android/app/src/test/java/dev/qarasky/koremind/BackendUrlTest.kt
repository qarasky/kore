package dev.qarasky.koremind

import dev.qarasky.koremind.data.normalizeBackendUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BackendUrlTest {
    @Test fun `normalizeBackendUrl adds http strips slash rejects garbage`() {
        assertEquals("http://192.168.1.20:8787", normalizeBackendUrl("192.168.1.20:8787"))
        assertEquals("http://localhost:8787", normalizeBackendUrl("  localhost:8787/ "))
        assertEquals("https://koremind.example.com", normalizeBackendUrl("https://koremind.example.com/"))
        assertEquals("http://koremind.example.com/base", normalizeBackendUrl("http://koremind.example.com/base/?x=1#y"))
        assertNull(normalizeBackendUrl(""))
        assertNull(normalizeBackendUrl("not a url!!"))
        assertNull(normalizeBackendUrl("ftp://host"))
    }
}

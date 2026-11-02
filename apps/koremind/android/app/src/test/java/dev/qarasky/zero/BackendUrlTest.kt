package dev.qarasky.zero

import dev.qarasky.zero.data.normalizeBackendUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BackendUrlTest {
    @Test fun `normalizeBackendUrl adds http strips slash rejects garbage`() {
        assertEquals("http://192.168.1.20:8787", normalizeBackendUrl("192.168.1.20:8787"))
        assertEquals("http://localhost:8787", normalizeBackendUrl("  localhost:8787/ "))
        assertEquals("https://zero.example.com", normalizeBackendUrl("https://zero.example.com/"))
        assertEquals("http://zero.example.com/base", normalizeBackendUrl("http://zero.example.com/base/?x=1#y"))
        assertNull(normalizeBackendUrl(""))
        assertNull(normalizeBackendUrl("not a url!!"))
        assertNull(normalizeBackendUrl("ftp://host"))
    }
}

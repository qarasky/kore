package dev.qarasky.koremind

import dev.qarasky.koremind.data.Source
import dev.qarasky.koremind.data.addSource
import dev.qarasky.koremind.data.dedupeSources
import dev.qarasky.koremind.data.sourceHost
import dev.qarasky.koremind.data.sourceKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Test

class SourcesTest {
    @Test fun `the same page gives the same key despite tracking, fragments, www and trailing slashes`() {
        val k = sourceKey("https://runpod.io/pricing")
        for (u in listOf("https://www.runpod.io/pricing/", "https://runpod.io/pricing#gpu", "https://RUNPOD.io/pricing?utm_source=x&utm_medium=y", "https://runpod.io/pricing?srsltid=abc")) assertEquals(u, k, sourceKey(u))
        assertEquals(sourceKey("https://runpod.io/pricing?a=1&b=2"), sourceKey("https://runpod.io/pricing?b=2&a=1"))
        assertNotEquals(k, sourceKey("https://runpod.io/pricing?gpu=h100"))
        assertEquals("not a url", sourceKey("not a url"))
    }

    @Test fun `repeats are dropped, first one kept, order kept`() {
        val list = listOf(
            Source("Gemini API Pricing 2026", "https://example.com/gemini?utm_source=a"),
            Source("Runpod pricing", "https://runpod.io/pricing"),
            Source("Gemini API Pricing 2026", "https://example.com/gemini/"),
            Source("gemini api pricing 2026 ", "https://example.com/gemini-pricing"),
            Source("Gemini API Pricing 2026", "https://other.org/gemini"),
            Source("Runpod pricing", "https://www.runpod.io/pricing"),
        )
        assertEquals(listOf("https://example.com/gemini?utm_source=a", "https://runpod.io/pricing", "https://other.org/gemini"), dedupeSources(list).map { it.url })
    }

    @Test fun `adding a known source changes nothing`() {
        val a = listOf(Source("A", "https://a.com/x"))
        assertSame(a, addSource(a, Source("A again", "https://www.a.com/x/")))
        assertEquals(2, addSource(a, Source("B", "https://b.com")).size)
    }

    @Test fun `the list shows the site without www`() {
        assertEquals("runpod.io", sourceHost("https://www.runpod.io/pricing"))
        assertEquals("", sourceHost("nope"))
    }
}

package dev.qarasky.zero

import dev.qarasky.zero.data.ModelInfo
import dev.qarasky.zero.data.ProviderInfo
import dev.qarasky.zero.ui.model.filterModels
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelFilterTest {
    private val providers = listOf(
        ProviderInfo("opencode", "OpenCode", true, listOf(
            ModelInfo("fast", "Fast One", false, emptyList(), true),
            ModelInfo("deep", "Deep Think", true, listOf("low", "high"), false),
        )),
        ProviderInfo("other", "Other", true, listOf(ModelInfo("x", "Xtra", false, emptyList(), true))),
    )

    @Test fun `filterModels favorites rail`() {
        assertEquals(listOf("opencode/deep", "other/x"), filterModels(providers, setOf("opencode/deep", "other/x"), "favorites", "").map { it.key })
    }

    @Test fun `filterModels search case-insensitive`() {
        assertEquals(listOf("opencode/deep"), filterModels(providers, emptySet(), "opencode", "THINK").map { it.key })
    }

    @Test fun `filterModels provider rail ignores favorites and other providers`() {
        assertEquals(listOf("opencode/fast", "opencode/deep"), filterModels(providers, setOf("other/x"), "opencode", "").map { it.key })
    }
}

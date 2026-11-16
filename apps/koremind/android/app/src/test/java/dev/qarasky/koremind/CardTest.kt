package dev.qarasky.koremind

import dev.qarasky.koremind.ui.chat.Card
import dev.qarasky.koremind.ui.chat.CardSection
import dev.qarasky.koremind.ui.chat.isNumericColumn
import dev.qarasky.koremind.ui.chat.parseCard
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import java.io.File
import org.junit.Test

/** The same fixtures as shared/test/cards.test.ts: web and Android must read a card identically. */
class CardTest {
    private fun fixturesFile(): File {
        var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
        while (dir != null) {
            val f = File(dir, "shared/fixtures/cards.json")
            if (f.exists()) return f
            dir = dir.parentFile
        }
        error("shared/fixtures/cards.json not found above ${System.getProperty("user.dir")}")
    }

    /** Numbers compare as doubles (a share of 1 and 1.0 are the same). */
    private fun norm(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.mapValues { norm(it.value) })
        is JsonArray -> JsonArray(e.map(::norm))
        is JsonNull -> e
        is JsonPrimitive -> if (!e.isString) e.content.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: e else e
    }

    private fun Card.toJson(): JsonElement = buildJsonObject {
        title?.let { put("title", it) }
        subtitle?.let { put("subtitle", it) }
        badge?.let { b -> put("badge", buildJsonObject { put("text", b.text); put("tone", b.tone.id) }) }
        put("sections", buildJsonArray {
            sections.forEach { s ->
                add(buildJsonObject {
                    when (s) {
                        is CardSection.Stats -> { put("type", "stats"); put("items", buildJsonArray { s.items.forEach { i -> add(buildJsonObject { put("label", i.label); put("value", i.value); i.tone?.let { put("tone", it.id) } }) } }) }
                        is CardSection.Table -> {
                            put("type", "table"); put("columns", buildJsonArray { s.columns.forEach { add(JsonPrimitive(it)) } })
                            put("rows", buildJsonArray { s.rows.forEach { r -> add(buildJsonArray { r.forEach { add(JsonPrimitive(it)) } }) } }); put("totalRow", s.totalRow)
                        }
                        is CardSection.Bars -> { put("type", "bars"); put("items", buildJsonArray { s.items.forEach { i -> add(buildJsonObject { put("label", i.label); put("value", i.value); put("share", i.share); i.tone?.let { put("tone", it.id) } }) } }) }
                        is CardSection.Note -> { put("type", "note"); put("text", s.text) }
                    }
                })
            }
        })
    }

    @Test fun `every shared fixture reads the same as on web`() {
        val fixtures = Json.parseToJsonElement(fixturesFile().readText()).jsonArray
        assertTrue(fixtures.size >= 11)
        for (f in fixtures) {
            val o = f.jsonObject
            val name = o["name"]!!.jsonPrimitive.content
            val got = parseCard(o["raw"]!!.jsonPrimitive.content)
            val want = o["card"]!!
            if (want is JsonNull) assertEquals("fixture '$name' should not be a card", null, got)
            else assertEquals("fixture '$name'", norm(want), norm(got?.toJson() ?: JsonNull))
        }
    }

    @Test fun `numeric columns are right-aligned and text columns are not`() {
        assertTrue(isNumericColumn(listOf(listOf("€60,000"), listOf("€6,667"), listOf("—")), 0))
        assertTrue(isNumericColumn(listOf(listOf("3.29M–4.89M"), listOf("€1.22M")), 0))
        assertTrue(isNumericColumn(listOf(listOf("12%"), listOf("-4.5%"), listOf("+3")), 0))
        assertFalse(isNumericColumn(listOf(listOf("1.7× growth"), listOf("2")), 0))
        assertFalse(isNumericColumn(listOf(listOf("Skyler"), listOf("Anuar")), 0))
        assertFalse(isNumericColumn(listOf(listOf("12"), listOf("n/a")), 0))
        assertFalse(isNumericColumn(emptyList(), 0))
        assertTrue(isNumericColumn(listOf(listOf("12"), emptyList()), 0)) // a short row doesn't decide
    }
}

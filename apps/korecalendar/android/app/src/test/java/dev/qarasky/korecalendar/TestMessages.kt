package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.edit.Messages
import java.io.File

/** The app's real `strings.xml`, so the logic's wording is tested as shipped. */
object TestMessages : Messages {
    private val strings: Map<String, String> by lazy {
        val xml = File("src/main/res/values/strings.xml").readText()
        Regex("""<string name="([a-z0-9_]+)"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL).findAll(xml).associate { m ->
            m.groupValues[1] to m.groupValues[2].replace("\\'", "'").replace("\\\"", "\"").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        }
    }

    override fun get(key: String, vararg args: Any?): String {
        val text = strings[key] ?: error("no string named $key in strings.xml")
        return if (args.isEmpty()) text else String.format(text, *args)
    }
}

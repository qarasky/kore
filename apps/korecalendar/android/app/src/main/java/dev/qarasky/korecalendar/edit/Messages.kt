package dev.qarasky.korecalendar.edit

/**
 * Text for pure logic that has to say something (a repeat rule in words, a reminder's lead time).
 * [key] is a `strings.xml` name; the phone looks it up, tests read the real file, so the words live in one place.
 */
fun interface Messages {
    fun get(key: String, vararg args: Any?): String
}

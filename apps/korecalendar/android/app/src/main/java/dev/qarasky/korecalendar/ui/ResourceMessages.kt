package dev.qarasky.korecalendar.ui

import android.content.Context
import dev.qarasky.korecalendar.edit.Messages

/** Looks the logic's wording up in `strings.xml` by name (the tests read the same file). */
class ResourceMessages(private val context: Context) : Messages {
    @Suppress("DiscouragedApi")
    override fun get(key: String, vararg args: Any?): String {
        val id = context.resources.getIdentifier(key, "string", context.packageName)
        check(id != 0) { "no string named $key" }
        return if (args.isEmpty()) context.getString(id) else context.getString(id, *args)
    }
}

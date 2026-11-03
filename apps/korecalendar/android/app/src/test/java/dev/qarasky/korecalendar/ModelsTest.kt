package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.ApiJson
import dev.qarasky.korecalendar.data.ChangeSet
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.Session
import java.time.Instant
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    @Test fun decodesAnOccurrenceAndIgnoresUnknownFields() {
        val json = """[{"event_id":"e1","calendar_id":"c1","key":"2026-11-04T16:00:00","title":"Gym","notes":"","location":"Club",
          "start":"2026-11-04T16:00:00","end":"2026-11-04T17:00:00","tz":"Europe/Berlin","all_day":false,"is_recurring":true,
          "is_override":false,"start_utc":"2026-11-04T15:00:00Z","end_utc":"2026-11-04T16:00:00Z","reminders":[{"minutes_before":30}],
          "something_new":42}]"""
        val o = ApiJson.decodeFromString(ListSerializer(Occurrence.serializer()), json).single()
        assertEquals("e1", o.eventId)
        assertEquals("Gym", o.title)
        assertTrue(o.isRecurring)
        assertFalse(o.allDay)
        assertEquals(Instant.parse("2026-11-04T15:00:00Z"), o.startUtc)
        assertEquals(30, o.reminders.single().minutesBefore)
    }

    @Test fun missingOptionalFieldsFallBackToDefaults() {
        val json = """{"event_id":"e","calendar_id":"c","key":"k","title":"t","start":"2026-11-04","end":"2026-11-05","tz":"UTC",
          "all_day":true,"start_utc":"2026-11-04T00:00:00Z","end_utc":"2026-11-05T00:00:00Z"}"""
        val o = ApiJson.decodeFromString(Occurrence.serializer(), json)
        assertEquals("", o.notes)
        assertEquals("", o.location)
        assertTrue(o.reminders.isEmpty())
        assertFalse(o.isRecurring)
    }

    @Test fun decodesAChangeSet() {
        val json = """{"cursor":42,"upserted":[{"id":"e1","calendar_id":"c1","title":"x","version":3,"rrule":"","reminders":[]}],"deleted":["e0"],"more":true}"""
        val c = ApiJson.decodeFromString(ChangeSet.serializer(), json)
        assertEquals(42L, c.cursor)
        assertEquals("e1", c.upserted.single().id)
        assertEquals(3, c.upserted.single().version)
        assertEquals(listOf("e0"), c.deleted)
        assertTrue(c.more)
    }

    @Test fun decodesASession() {
        val s = ApiJson.decodeFromString(Session.serializer(), """{"token":"tok","user":{"id":"u","email":"a@b.c","role":"admin","timezone":"UTC"}}""")
        assertEquals("tok", s.token)
        assertEquals("UTC", s.user.timezone)
    }
}

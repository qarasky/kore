package dev.qarasky.korecalendar.data

import java.time.Instant
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json

/** How the API's JSON is read: new server fields must not break an older app. */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder): Instant = Instant.parse(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())
}

@Serializable
data class User(val id: String, val email: String, val role: String = "user", val timezone: String = "UTC")

@Serializable
data class Session(val token: String, val user: User)

@Serializable
data class TokenCreated(val id: String, val name: String, val token: String)

@Serializable
data class Calendar(val id: String, val name: String, val color: String = "#5b8def")

@Serializable
data class Reminder(@SerialName("minutes_before") val minutesBefore: Int)

@Serializable
data class Occurrence(
    @SerialName("event_id") val eventId: String,
    @SerialName("calendar_id") val calendarId: String,
    val key: String,
    val title: String,
    val notes: String = "",
    val location: String = "",
    val start: String,
    val end: String,
    val tz: String,
    @SerialName("all_day") val allDay: Boolean = false,
    @SerialName("is_recurring") val isRecurring: Boolean = false,
    @SerialName("is_override") val isOverride: Boolean = false,
    @SerialName("start_utc") @Serializable(InstantSerializer::class) val startUtc: Instant,
    @SerialName("end_utc") @Serializable(InstantSerializer::class) val endUtc: Instant,
    val reminders: List<Reminder> = emptyList(),
)

/** An event or a whole series as the server keeps it (the change feed lists these too). */
@Serializable
data class Event(
    val id: String,
    @SerialName("calendar_id") val calendarId: String = "",
    val title: String = "",
    val notes: String = "",
    val location: String = "",
    val start: String = "",
    val end: String = "",
    val tz: String = "UTC",
    @SerialName("all_day") val allDay: Boolean = false,
    val rrule: String = "",
    val rdates: List<String> = emptyList(),
    val exdates: List<String> = emptyList(),
    val reminders: List<Reminder> = emptyList(),
    val version: Int = 0,
    @SerialName("deleted_at") val deletedAt: Long? = null,
)

@Serializable
data class ChangeSet(
    val cursor: Long,
    val upserted: List<Event> = emptyList(),
    val deleted: List<String> = emptyList(),
    val more: Boolean = false,
)

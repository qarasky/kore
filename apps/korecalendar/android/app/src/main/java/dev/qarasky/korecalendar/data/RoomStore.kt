package dev.qarasky.korecalendar.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import java.time.Instant

@Entity(tableName = "calendars")
data class CalendarRow(@PrimaryKey val id: String, val name: String, val color: String, val position: Int)

@Entity(tableName = "occurrences", primaryKeys = ["eventId", "key"])
data class OccurrenceRow(
    val eventId: String,
    val key: String,
    val calendarId: String,
    val title: String,
    val notes: String,
    val location: String,
    val start: String,
    val end: String,
    val tz: String,
    val allDay: Boolean,
    val isRecurring: Boolean,
    val isOverride: Boolean,
    val startUtc: Long,
    val endUtc: Long,
    /** minutes_before values, comma separated. */
    val reminders: String,
)

@Entity(tableName = "meta")
data class MetaRow(@PrimaryKey val k: String, val v: String)

@Dao
interface StoreDao {
    @Query("SELECT * FROM calendars ORDER BY position") suspend fun calendars(): List<CalendarRow>
    @Query("SELECT * FROM occurrences ORDER BY startUtc, eventId, `key`") suspend fun occurrences(): List<OccurrenceRow>
    @Query("SELECT v FROM meta WHERE k = :k") suspend fun meta(k: String): String?
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun putMeta(row: MetaRow)
    @Query("DELETE FROM meta WHERE k = :k") suspend fun deleteMeta(k: String)
    @Query("DELETE FROM calendars") suspend fun deleteCalendars()
    @Query("DELETE FROM occurrences") suspend fun deleteOccurrences()
    @Query("DELETE FROM meta") suspend fun deleteAllMeta()
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertCalendars(rows: List<CalendarRow>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertOccurrences(rows: List<OccurrenceRow>)
}

@Database(entities = [CalendarRow::class, OccurrenceRow::class, MetaRow::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun dao(): StoreDao

    companion object {
        fun open(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "korecalendar.db").build()
    }
}

/** The phone's copy in a Room database. `commit` is one transaction, so a sync lands whole or not at all. */
class RoomStore(private val db: AppDatabase) : LocalStore {
    private val dao = db.dao()

    override suspend fun snapshot(): Snapshot = db.withTransaction {
        Snapshot(
            calendars = dao.calendars().map { Calendar(it.id, it.name, it.color) },
            occurrences = dao.occurrences().map { it.toModel() },
            lastSyncAt = dao.meta(SYNCED)?.toLongOrNull()?.let(Instant::ofEpochMilli),
            accountId = dao.meta(ACCOUNT),
        )
    }

    override suspend fun cursor(): Long = dao.meta(CURSOR)?.toLongOrNull() ?: 0L

    override suspend fun windowFrom(): Instant? = dao.meta(WINDOW)?.toLongOrNull()?.let(Instant::ofEpochMilli)

    override suspend fun commit(
        accountId: String,
        calendars: List<Calendar>,
        occurrences: List<Occurrence>?,
        windowFrom: Instant?,
        cursor: Long,
        syncedAt: Instant,
    ) = db.withTransaction {
        dao.deleteCalendars()
        dao.insertCalendars(calendars.mapIndexed { i, c -> CalendarRow(c.id, c.name, c.color, i) })
        if (occurrences != null) {
            dao.deleteOccurrences()
            dao.insertOccurrences(occurrences.map { it.toRow() })
            if (windowFrom != null) dao.putMeta(MetaRow(WINDOW, windowFrom.toEpochMilli().toString()))
        }
        dao.putMeta(MetaRow(ACCOUNT, accountId))
        dao.putMeta(MetaRow(CURSOR, cursor.toString()))
        dao.putMeta(MetaRow(SYNCED, syncedAt.toEpochMilli().toString()))
    }

    override suspend fun clear() = db.withTransaction {
        dao.deleteCalendars()
        dao.deleteOccurrences()
        dao.deleteAllMeta()
    }

    private companion object {
        const val ACCOUNT = "account"
        const val CURSOR = "cursor"
        const val WINDOW = "windowFrom"
        const val SYNCED = "syncedAt"
    }
}

private fun Occurrence.toRow() = OccurrenceRow(
    eventId, key, calendarId, title, notes, location, start, end, tz, allDay, isRecurring, isOverride,
    startUtc.toEpochMilli(), endUtc.toEpochMilli(), reminders.joinToString(",") { it.minutesBefore.toString() },
)

private fun OccurrenceRow.toModel() = Occurrence(
    eventId = eventId, calendarId = calendarId, key = key, title = title, notes = notes, location = location,
    start = start, end = end, tz = tz, allDay = allDay, isRecurring = isRecurring, isOverride = isOverride,
    startUtc = Instant.ofEpochMilli(startUtc), endUtc = Instant.ofEpochMilli(endUtc),
    reminders = reminders.split(',').filter { it.isNotEmpty() }.map { Reminder(it.toInt()) },
)

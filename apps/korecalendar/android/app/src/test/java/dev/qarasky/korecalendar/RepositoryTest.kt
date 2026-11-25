package dev.qarasky.korecalendar

import dev.qarasky.korecalendar.data.Calendar
import dev.qarasky.korecalendar.data.Repository
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class RepositoryTest {
    private val store = FakeStore()
    private val repo = Repository(store)

    @Test fun isNullUntilTheFirstRead() = runTest {
        assertNull(repo.snapshot.value)
        repo.refreshFromStore()
        assertNotNull(repo.snapshot.value)
        assertEquals(emptyList<Calendar>(), repo.snapshot.value!!.calendars)
    }

    @Test fun showsWhatTheStoreHoldsAfterEachRefresh() = runTest {
        repo.refreshFromStore()
        store.commit("u1", listOf(Calendar("c1", "Work", "#7b6cf0")), emptyList(), Instant.parse("2026-10-21T00:00:00Z"), 3, Instant.parse("2026-11-04T10:00:00Z"))
        assertEquals(emptyList<Calendar>(), repo.snapshot.value!!.calendars) // not until asked
        repo.refreshFromStore()
        assertEquals("Work", repo.snapshot.value!!.calendars.single().name)
        assertEquals(Instant.parse("2026-11-04T10:00:00Z"), repo.snapshot.value!!.lastSyncAt)
        store.clear()
        repo.refreshFromStore()
        assertEquals(emptyList<Calendar>(), repo.snapshot.value!!.calendars)
    }
}

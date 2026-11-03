package dev.qarasky.korecalendar.edit

import dev.qarasky.korecalendar.data.ApiException
import dev.qarasky.korecalendar.data.CalendarApi
import dev.qarasky.korecalendar.data.Event
import dev.qarasky.korecalendar.data.Occurrence
import dev.qarasky.korecalendar.data.WriteResult
import java.time.Duration
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

sealed interface EditorState {
    data object Closed : EditorState
    data object Loading : EditorState
    data class LoadFailed(val message: String) : EditorState

    /**
     * The form the person is working on. A failed save only sets [banner] (and [conflict] for a stale
     * version): the form stays exactly as typed.
     */
    data class Editing(
        val form: FormValues,
        val errors: FormErrors,
        val saving: Boolean,
        val banner: String?,
        val conflict: Boolean,
        val creating: Boolean,
        val recurring: Boolean,
    ) : EditorState
}

sealed interface SaveResult {
    data class Saved(val message: String) : SaveResult
    data object Unchanged : SaveResult
    data object Invalid : SaveResult
    data object Failed : SaveResult
}

sealed interface DeleteResult {
    data class Deleted(val message: String, val eventId: String) : DeleteResult
    data class Failed(val message: String) : DeleteResult
}

/**
 * Create, edit, delete and undo, with the web editor's safety and no Android in it. Every write goes
 * straight to the server (`If-Match` with the version, an `Idempotency-Key` on creates); a failure
 * leaves the form as typed; a success calls [onWritten] so the app syncs and the screens and the
 * widget agree. Use one editor from one coroutine at a time (the UI does).
 */
class EventEditor(
    private val api: CalendarApi,
    private val msg: Messages,
    private val newKey: () -> String,
    private val onWritten: suspend () -> Unit,
) {
    private val _state = MutableStateFlow<EditorState>(EditorState.Closed)
    val state: StateFlow<EditorState> = _state

    private var master: Event? = null
    private var occurrence: Occurrence? = null
    private var attempt: Attempt? = null

    private fun editing(): EditorState.Editing? = _state.value as? EditorState.Editing

    fun openNew(form: FormValues) {
        master = null
        occurrence = null
        attempt = null
        _state.value = EditorState.Editing(form, FormErrors(null, null), saving = false, banner = null, conflict = false, creating = true, recurring = false)
    }

    suspend fun openExisting(occ: Occurrence) {
        attempt = null
        _state.value = EditorState.Loading
        try {
            val e = api.event(occ.eventId)
            master = e
            occurrence = occ
            _state.value = EditorState.Editing(
                formFromEvent(e, occ), FormErrors(null, null), saving = false, banner = null, conflict = false, creating = false,
                recurring = occ.isRecurring,
            )
        } catch (e: Exception) {
            _state.value = EditorState.LoadFailed(errorMessage(e, msg))
        }
    }

    fun close() {
        master = null
        occurrence = null
        attempt = null
        _state.value = EditorState.Closed
    }

    /** Applies a change to the form; the error under a field goes away when the person touches the form. */
    fun edit(change: (FormValues) -> FormValues) {
        val s = editing() ?: return
        _state.value = s.copy(form = change(s.form), errors = FormErrors(null, null), banner = if (s.conflict) s.banner else null)
    }

    /** The scopes that are safe for the form as it is now (one, "all events", for a single event). */
    fun scopes(): List<Scope> {
        val s = editing() ?: return listOf(Scope.All)
        val m = master ?: return listOf(Scope.All)
        return planUpdate(m, occurrence, s.form, Scope.All).allowedScopes
    }

    /** False for an existing event whose form still equals what the server has: saving would send nothing. */
    fun hasChanges(): Boolean {
        val s = editing() ?: return false
        val m = master ?: return true
        return planUpdate(m, occurrence, s.form, Scope.All).requests.isNotEmpty()
    }

    fun deleteScopes(occ: Occurrence): List<Scope> = if (occ.isRecurring) listOf(Scope.This, Scope.Following, Scope.All) else listOf(Scope.All)

    suspend fun save(scope: Scope): SaveResult {
        val s = editing() ?: return SaveResult.Failed
        if (s.saving) return SaveResult.Failed
        val errors = validateForm(s.form)
        if (errors.any) {
            _state.value = s.copy(errors = errors)
            return SaveResult.Invalid
        }
        val m = master
        val plan = if (s.creating || m == null) planCreate(s.form) else planUpdate(m, occurrence, s.form, scope)
        if (plan.requests.isEmpty()) {
            close()
            return SaveResult.Unchanged
        }
        _state.value = s.copy(saving = true, banner = null, conflict = false)
        val results = ArrayList<WriteResult>()
        try {
            for (req in plan.requests) {
                val sent = if (s.creating || m == null) {
                    attempt = nextAttempt(attempt, req, newKey)
                    req.copy(idempotencyKey = attempt!!.key)
                } else {
                    req
                }
                results += api.write(sent)
            }
        } catch (e: Exception) {
            val conflict = e is ApiException && e.code == "version_conflict"
            _state.value = s.copy(saving = false, banner = errorMessage(e, msg), conflict = conflict)
            return SaveResult.Failed
        }
        val base = msg.get(if (s.creating) "toast_created" else "toast_saved")
        val dropped = droppedOverrides(results)
        val text = when (dropped) {
            0 -> base
            1 -> "$base. ${msg.get("toast_dropped_one")}"
            else -> "$base. ${msg.get("toast_dropped_many", dropped)}"
        }
        close()
        onWritten()
        return SaveResult.Saved(text)
    }

    /** After a conflict: throws away what was typed and shows the event as the server has it now. */
    suspend fun reload() {
        val old = occurrence
        val id = master?.id ?: return
        _state.value = EditorState.Loading
        try {
            val fresh = api.event(id)
            val key = old?.key
            val near = old?.startUtc?.let { it.minus(Duration.ofDays(2)) to it.plus(Duration.ofDays(2)) }
            val occ = if (key != null && near != null) api.occurrences(near.first, near.second).firstOrNull { it.eventId == id && it.key == key } else null
            if (old != null && occ == null) {
                _state.value = EditorState.LoadFailed(msg.get("edit_err_not_found"))
                return
            }
            master = fresh
            occurrence = occ
            _state.value = EditorState.Editing(
                formFromEvent(fresh, occ), FormErrors(null, null), saving = false, banner = null, conflict = false, creating = false,
                recurring = occ?.isRecurring ?: (fresh.rrule != ""),
            )
        } catch (e: Exception) {
            _state.value = EditorState.LoadFailed(errorMessage(e, msg))
        }
    }

    /** Deletes [occ] at [scope] (the version comes from a fresh read, so a stale screen cannot delete over someone else's change). */
    suspend fun delete(occ: Occurrence, scope: Scope): DeleteResult {
        try {
            val m = api.event(occ.eventId)
            val plan = planDelete(m, occ, scope)
            for (req in plan.requests) api.write(req)
        } catch (e: Exception) {
            return DeleteResult.Failed(errorMessage(e, msg))
        }
        onWritten()
        return DeleteResult.Deleted(msg.get("toast_deleted"), occ.eventId)
    }

    /** Brings back a deleted event (valid for 30 days). Returns the message to show, or the error. */
    suspend fun undo(eventId: String): String {
        try {
            api.restoreEvent(eventId)
        } catch (e: Exception) {
            return errorMessage(e, msg)
        }
        onWritten()
        return msg.get("toast_restored")
    }
}

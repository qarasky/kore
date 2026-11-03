package dev.qarasky.korecalendar.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import dev.qarasky.korecalendar.R
import dev.qarasky.korecalendar.ui.theme.Palette
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

private sealed interface Screen {
    data object Agenda : Screen
    data class Details(val eventId: String, val key: String) : Screen
    data object Settings : Screen
}

/** The app: sign-in when there is no usable account, otherwise the agenda with its two sub-screens. */
@Composable
fun AppRoot(controller: AppController, pendingOpen: StateFlow<Pair<String, String>?>, onOpened: () -> Unit) {
    val state by controller.state.collectAsState()
    val pending by pendingOpen.collectAsState()
    val editor by controller.editor.collectAsState()
    val notice by controller.notice.collectAsState()
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    val msg = remember { ResourceMessages(context) }
    var deleting by remember { mutableStateOf<dev.qarasky.korecalendar.data.Occurrence?>(null) }
    val undoLabel = stringResource(R.string.undo)
    val snackbar = remember { androidx.compose.material3.SnackbarHostState() }
    var screen by remember { mutableStateOf<Screen>(Screen.Agenda) }
    var openEventId by rememberSaveable { mutableStateOf<String?>(null) }
    var openEventKey by rememberSaveable { mutableStateOf<String?>(null) }
    val current: Screen = when {
        openEventId != null && openEventKey != null -> Screen.Details(openEventId!!, openEventKey!!)
        else -> screen
    }

    // A tap on the widget asks for one event.
    LaunchedEffect(pending) {
        pending?.let { (id, key) ->
            openEventId = id
            openEventKey = key
            onOpened()
        }
    }

    // "Now" moves: ended events dim and "Today" rolls over.
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            controller.tick()
        }
    }

    // A short message after a write; a delete offers Undo.
    LaunchedEffect(notice) {
        val n = notice ?: return@LaunchedEffect
        val undo = n.undoEventId
        val result = snackbar.showSnackbar(
            message = n.message,
            actionLabel = if (undo != null) undoLabel else null,
            withDismissAction = undo == null,
            duration = if (undo != null) androidx.compose.material3.SnackbarDuration.Long else androidx.compose.material3.SnackbarDuration.Short,
        )
        if (result == androidx.compose.material3.SnackbarResult.ActionPerformed && undo != null) controller.undoDelete(undo) else controller.dismissNotice()
    }

    Box(Modifier.fillMaxSize()) {
    when (val s = state) {
        AppState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Palette.accent)
        }
        is AppState.SignedOut -> SignInScreen(s) { url, email, password -> controller.signIn(url, email, password) }
        is AppState.Ready -> if (editor != null) {
            EditorScreen(controller, editor!!, s, msg, onClose = { controller.endEdit() })
        } else when (current) {
            Screen.Agenda -> AgendaScreen(
                state = s,
                onRefresh = { controller.refresh() },
                onOpen = { id, key -> openEventId = id; openEventKey = key },
                onSettings = { screen = Screen.Settings },
                onNew = { controller.beginNew() },
            )
            is Screen.Details -> EventDetailsScreen(
                s, (current as Screen.Details).eventId, current.key,
                onBack = { openEventId = null; openEventKey = null },
                onEdit = { occ -> scope.launch { controller.beginEdit(occ) } },
                onDelete = { occ -> deleting = occ },
            )
            Screen.Settings -> SettingsScreen(
                state = s,
                onBack = { screen = Screen.Agenda },
                onClock24 = { scope.launch { controller.setClock24(it) } },
                onToggleCalendar = { scope.launch { controller.toggleCalendar(it) } },
                onSignOut = { screen = Screen.Agenda; scope.launch { controller.signOut() } },
            )
        }
    }
    androidx.compose.material3.SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(16.dp))
    }

    deleting?.let { occ ->
        val title = occ.title.ifBlank { stringResource(R.string.no_title) }
        if (occ.isRecurring) {
            ScopeDialog(
                delete = true, allowed = listOf(dev.qarasky.korecalendar.edit.Scope.This, dev.qarasky.korecalendar.edit.Scope.Following, dev.qarasky.korecalendar.edit.Scope.All),
                onPick = { sc -> deleting = null; openEventId = null; openEventKey = null; scope.launch { controller.delete(occ, sc) } },
                onDismiss = { deleting = null },
            )
        } else {
            ConfirmDeleteDialog(
                title = title,
                onConfirm = { deleting = null; openEventId = null; openEventKey = null; scope.launch { controller.delete(occ, dev.qarasky.korecalendar.edit.Scope.All) } },
                onDismiss = { deleting = null },
            )
        }
    }
}
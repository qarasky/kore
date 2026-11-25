package dev.qarasky.koremind.ui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.navArgument
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.compose.ui.res.stringResource
import dev.qarasky.koremind.R
import dev.qarasky.koremind.ui.theme.KoreMindColors
import dev.qarasky.koremind.ui.auth.ConnectScreen
import dev.qarasky.koremind.ui.auth.LoginScreen
import dev.qarasky.koremind.ui.chat.ChatScreen
import dev.qarasky.koremind.ui.settings.SettingsScreen
import dev.qarasky.koremind.ui.theme.LocalMotion

@Composable
fun KoreMindApp(vm: AppViewModel) {
    val nav = rememberNavController()
    val session by vm.session.collectAsStateWithLifecycle()
    val start = when { session.baseUrl == null -> "connect"; !session.signedIn -> "login"; else -> "chat" }

    // Signing out (or losing the server) sends you back to the right screen from anywhere.
    LaunchedEffect(session.signedIn, session.baseUrl) {
        val dest = when { session.baseUrl == null -> "connect"; !session.signedIn -> "login"; else -> null }
        val here = nav.currentDestination?.route
        if (dest != null && here != dest && here != "connect") nav.navigate(dest) { popUpTo(0) }
    }

    // A finished pairing (scanned QR or opened koremind://pair link) lands on the chat home.
    val pair by vm.pairState.collectAsStateWithLifecycle()
    val route = nav.currentBackStackEntryAsState().value?.destination?.route
    LaunchedEffect(pair) {
        if (pair is PairUi.Done) { nav.navigate("chat") { popUpTo(0) }; vm.pairHandled() }
    }
    // The auth screens show pairing progress and errors themselves; anywhere else a dialog does.
    val onAuthScreen = route == "connect" || route == "login"
    if (!onAuthScreen) {
        val failed = pair as? PairUi.Failed
        if (pair is PairUi.Working) AlertDialog(onDismissRequest = {}, containerColor = KoreMindColors.Raised, confirmButton = {}, text = { Text(stringResource(R.string.pair_connecting)) })
        if (failed != null) AlertDialog(
            onDismissRequest = vm::pairHandled, containerColor = KoreMindColors.Raised,
            text = { Text(stringResource(failed.message)) },
            confirmButton = { TextButton(onClick = vm::pairHandled) { Text(stringResource(android.R.string.ok)) } },
        )
    }

    // Screens fade and drift a few dp: short, and gone entirely when the system asks for no animations.
    val on = LocalMotion.current
    NavHost(
        nav, startDestination = start,
        enterTransition = { if (on) fadeIn(tween(180)) + slideInHorizontally(tween(180)) { it / 14 } else EnterTransition.None },
        exitTransition = { if (on) fadeOut(tween(100)) else ExitTransition.None },
        popEnterTransition = { if (on) fadeIn(tween(180)) + slideInHorizontally(tween(180)) { -it / 14 } else EnterTransition.None },
        popExitTransition = { if (on) fadeOut(tween(100)) + slideOutHorizontally(tween(180)) { it / 14 } else ExitTransition.None },
    ) {
        composable("connect") { ConnectScreen(vm) { nav.navigate("login") { popUpTo(0) } } }
        composable("login") { LoginScreen(vm, onChangeServer = { nav.navigate("connect") }) }
        composable("chat") { ChatScreen(vm, onSettings = { nav.navigate("settings") }, onProviders = { nav.navigate("settings?section=providers") }) }
        composable("settings?section={section}", arguments = listOf(navArgument("section") { type = NavType.StringType; nullable = true; defaultValue = null })) { entry ->
            SettingsScreen(vm, entry.arguments?.getString("section"), onBack = { nav.popBackStack() }, onChangeServer = { nav.navigate("connect") })
        }
    }
}

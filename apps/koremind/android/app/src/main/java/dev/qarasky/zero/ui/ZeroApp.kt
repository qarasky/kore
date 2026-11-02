package dev.qarasky.zero.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dev.qarasky.zero.ui.auth.ConnectScreen
import dev.qarasky.zero.ui.auth.LoginScreen
import dev.qarasky.zero.ui.chat.ChatScreen
import dev.qarasky.zero.ui.settings.MemoryScreen
import dev.qarasky.zero.ui.settings.SettingsScreen

@Composable
fun ZeroApp(vm: AppViewModel) {
    val nav = rememberNavController()
    val session by vm.session.collectAsStateWithLifecycle()
    val start = when { session.baseUrl == null -> "connect"; !session.signedIn -> "login"; else -> "chat" }

    // Signing out (or losing the server) sends you back to the right screen from anywhere.
    LaunchedEffect(session.signedIn, session.baseUrl) {
        val dest = when { session.baseUrl == null -> "connect"; !session.signedIn -> "login"; else -> null }
        val here = nav.currentDestination?.route
        if (dest != null && here != dest && here != "connect") nav.navigate(dest) { popUpTo(0) }
    }

    NavHost(nav, startDestination = start) {
        composable("connect") { ConnectScreen(vm) { nav.navigate("login") { popUpTo(0) } } }
        composable("login") { LoginScreen(vm, onSignedIn = { nav.navigate("chat") { popUpTo(0) } }, onChangeServer = { nav.navigate("connect") }) }
        composable("chat") { ChatScreen(vm, onSettings = { nav.navigate("settings") }) }
        composable("settings") { SettingsScreen(vm, onBack = { nav.popBackStack() }, onMemory = { nav.navigate("memory") }, onChangeServer = { nav.navigate("connect") }) }
        composable("memory") { MemoryScreen(vm, onBack = { nav.popBackStack() }) }
    }
}

package dev.qarasky.korecalendar

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShotTest {
    @get:Rule val rule = createEmptyComposeRule()
    private val args = InstrumentationRegistry.getArguments()
    private val inst = InstrumentationRegistry.getInstrumentation()
    private fun shot(name: String) {
        rule.waitForIdle()
        Thread.sleep(600)
        val bmp = inst.uiAutomation.takeScreenshot()
        File("/sdcard/Download/$name.png").outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun shots() {
        val graph = Graph.get(inst.targetContext)
        runBlocking { graph.controller.signOut() }
        ActivityScenario.launch(MainActivity::class.java)
        rule.onNode(hasSetTextAction() and hasText("Server address")).performTextInput(args.getString("server")!!)
        rule.onNode(hasSetTextAction() and hasText("Email")).performTextInput(args.getString("email")!!)
        rule.onNode(hasSetTextAction() and hasText("Password")).performTextInput(args.getString("password")!!)
        rule.onNode(hasText("Sign in") and hasClickAction()).performClick()
        rule.waitUntilExactlyOneExists(hasText("Agenda"), 30_000)
        shot("1-agenda")
        rule.onNodeWithText("New event").performClick()
        rule.onNode(hasSetTextAction() and hasText("Title")).performTextInput("Planning")
        shot("2-editor")
        rule.onNodeWithText("Doesn't repeat").performScrollTo().performClick()
        shot("3-repeat")
        rule.onNodeWithText("Custom…").performClick()
        shot("4-custom")
    }
}

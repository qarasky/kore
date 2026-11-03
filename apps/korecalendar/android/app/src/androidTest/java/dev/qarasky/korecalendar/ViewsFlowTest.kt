package dev.qarasky.korecalendar

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.qarasky.korecalendar.data.ApiJson
import dev.qarasky.korecalendar.data.HttpApi
import dev.qarasky.korecalendar.data.WriteRequest
import dev.qarasky.korecalendar.data.normalizeServerUrl
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import org.junit.After
import org.junit.Assume
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Day, week and month views, the view switcher, search and a tap on an empty slot, on an emulator against a real server. */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class ViewsFlowTest {
    @get:Rule val rule = createEmptyComposeRule()

    private val args = InstrumentationRegistry.getArguments()
    private val server = args.getString("server")
    private val email = args.getString("email")
    private val password = args.getString("password")
    private val graph = Graph.get(InstrumentationRegistry.getInstrumentation().targetContext)
    private var scenario: ActivityScenario<MainActivity>? = null
    private val tomorrow: LocalDate = LocalDate.now(ZoneOffset.UTC).plusDays(1)

    @Before fun setUp() {
        Assume.assumeTrue("no server given: skipping the UI flows", server != null && email != null && password != null)
        // The system's notification permission dialog would cover the app: the tests grant it up front.
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(target.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        runBlocking { graph.controller.signOut() }
        runBlocking {
            val url = normalizeServerUrl(server!!)!!
            val s = HttpApi(url, HttpApi(url, null).login(email!!, password!!).token)
            s.write(WriteRequest("POST", "/api/events", ApiJson.parseToJsonElement("""{"title":"Kayak (views test)","start":"${tomorrow}T10:00:00","end":"${tomorrow}T11:00:00","tz":"UTC"}""") as JsonObject, null, null))
            s.logout()
        }
        scenario = ActivityScenario.launch(MainActivity::class.java)
        rule.onNode(hasSetTextAction() and hasText("Server address")).performTextInput(server!!)
        rule.onNode(hasSetTextAction() and hasText("Email")).performTextInput(email!!)
        rule.onNode(hasSetTextAction() and hasText("Password")).performTextInput(password!!)
        rule.onNode(hasText("Sign in") and hasClickAction()).performClick()
        rule.waitUntilExactlyOneExists(hasText("Agenda") and hasClickAction(), 30_000)
        rule.waitUntil(30_000) { rule.onAllNodesWithText("Not updated yet").fetchSemanticsNodes().isEmpty() }
    }

    @After fun tearDown() {
        scenario?.close()
        runBlocking { graph.controller.signOut() }
    }

    @Test fun theViewSwitcherShowsTheEventInEveryView() {
        for (view in listOf("Month", "Week", "Day")) {
            rule.onNode(hasText(view) and hasClickAction()).performClick()
            rule.onNode(hasText("Next") .or(hasContentDescription("Next"))).performClick() // jump a period ahead and back to prove navigation works
            rule.onNode(hasContentDescription("Previous")).performClick()
            // The event is tomorrow: in the month and week it is on the screen, in the day view it is one step ahead.
            if (view == "Day") rule.onNode(hasContentDescription("Next")).performClick()
            rule.waitUntilAtLeastOneExists(hasText("Kayak (views test)"), 20_000)
        }
    }

    @Test fun aTapOnADayOfTheMonthOpensThatDayAndTodayComesBack() {
        rule.onNode(hasText("Month") and hasClickAction()).performClick()
        rule.waitUntilAtLeastOneExists(hasText("Kayak (views test)"), 20_000)
        rule.onAllNodesWithText("Kayak (views test)").onFirst().performClick() // the chip sits inside the day's cell
        rule.waitUntilAtLeastOneExists(hasText("Day") and hasClickAction(), 10_000)
        rule.onNode(hasText("Today") and hasClickAction()).performClick()
    }

    @Test fun searchFindsTheEventAndOpensIt() {
        rule.onNode(hasText("Search") and hasClickAction()).performClick()
        rule.onNode(hasSetTextAction() and hasText("Search events")).performTextInput("kayak")
        rule.waitUntilAtLeastOneExists(hasText("Kayak (views test)"), 20_000)
        rule.onAllNodesWithText("Kayak (views test)").onFirst().performClick()
        rule.waitUntilAtLeastOneExists(hasText("Edit") and hasClickAction(), 10_000)
    }

    @Test fun aTapOnAnEmptySlotStartsANewEvent() {
        rule.onNode(hasText("Day") and hasClickAction()).performClick()
        rule.waitUntilAtLeastOneExists(hasContentDescription("tap an empty slot", substring = true), 10_000)
        rule.onNode(hasContentDescription("tap an empty slot", substring = true)).performTouchInput { click(androidx.compose.ui.geometry.Offset(width / 2f, 100f)) }
        rule.waitUntilAtLeastOneExists(hasText("New event") and !hasClickAction(), 10_000)
        rule.waitUntilAtLeastOneExists(hasSetTextAction() and hasText("Title"), 10_000)
    }
}

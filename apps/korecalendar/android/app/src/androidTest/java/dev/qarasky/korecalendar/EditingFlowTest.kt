package dev.qarasky.korecalendar

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.qarasky.korecalendar.data.Account
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

/**
 * The key flows on a real (emulated) phone against a real server: sign in, create, edit one occurrence of a series,
 * delete and undo. Needs `server`, `email` and `session` instrumentation arguments (`scripts/android-ui-test.sh`
 * starts a server and passes them); without them the tests are skipped.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class EditingFlowTest {
    @get:Rule val rule = createEmptyComposeRule()

    private val args = InstrumentationRegistry.getArguments()
    private val server = args.getString("server")
    private val email = args.getString("email")
    private val session = args.getString("session")
    private val graph = Graph.get(InstrumentationRegistry.getInstrumentation().targetContext)
    private var scenario: ActivityScenario<MainActivity>? = null
    private val tomorrow: LocalDate = LocalDate.now(ZoneOffset.UTC).plusDays(1)

    @Before fun setUp() {
        Assume.assumeTrue("no server given: skipping the UI flows", server != null && email != null && session != null)
        // The system's notification permission dialog would cover the app: the tests grant it up front.
        val target = InstrumentationRegistry.getInstrumentation().targetContext
        InstrumentationRegistry.getInstrumentation().uiAutomation.grantRuntimePermission(target.packageName, android.Manifest.permission.POST_NOTIFICATIONS)
        runBlocking {
            graph.controller.signOut()
            val url = normalizeServerUrl(server!!)!!
            val api = HttpApi(url, session!!)
            val me = api.me()
            val appToken = api.createToken("Android, ui test").token
            graph.accounts.save(Account(url.base, me.id, me.email, me.timezone, appToken))
        }
    }

    @After fun tearDown() {
        scenario?.close()
        runBlocking {
            graph.controller.signOut()
            val url = normalizeServerUrl(server!!)!!
            val api = HttpApi(url, session!!)
            val me = api.me()
            val appToken = api.createToken("Android, ui test").token
            graph.accounts.save(Account(url.base, me.id, me.email, me.timezone, appToken))
        }
    }

    /** Seeds the server the way an agent would: through the public API. */
    private fun seed(json: String) = runBlocking {
        val url = normalizeServerUrl(server!!)!!
        val s = HttpApi(url, session!!)
        val me = s.me()
        val appToken = s.createToken("Android, seed").token
        HttpApi(url, appToken).write(WriteRequest("POST", "/api/events", ApiJson.parseToJsonElement(json) as JsonObject, null, null))
    }

    private fun launchAndSignIn() {
        // The account is already seeded (see setUp); Kore ID itself needs a browser.
        scenario = ActivityScenario.launch(MainActivity::class.java)
        rule.waitUntilAtLeastOneExists(hasText("Agenda") and hasClickAction(), 60_000)
        // The first sync has to finish: until then the phone does not know the calendars or the events.
        rule.waitUntil(30_000) { rule.onAllNodesWithText("Not updated yet").fetchSemanticsNodes().isEmpty() }
    }

    @Test fun createAnEventFromTheAgenda() {
        launchAndSignIn()
        rule.onNodeWithText("New event").performClick()
        rule.onNode(hasSetTextAction() and hasText("Title")).performTextInput("Dentist (ui test)")
        rule.onNodeWithText("Save").performClick()
        rule.waitUntilAtLeastOneExists(hasText("Event created"), 20_000)
        rule.waitUntilAtLeastOneExists(hasText("Dentist (ui test)"), 20_000)
    }

    @Test fun editOneOccurrenceOfASeries() {
        seed("""{"title":"Standup (ui test)","start":"${tomorrow}T10:00:00","end":"${tomorrow}T10:15:00","tz":"UTC","rrule":"FREQ=DAILY"}""")
        launchAndSignIn()
        rule.waitUntilAtLeastOneExists(hasText("Standup (ui test)"), 20_000)
        rule.onAllNodesWithText("Standup (ui test)").onFirst().performClick()
        rule.onNodeWithText("Edit").performClick()
        rule.waitUntilAtLeastOneExists(hasSetTextAction() and hasText("Standup (ui test)"), 20_000)
        rule.onNode(hasSetTextAction() and hasText("Standup (ui test)")).performTextReplacement("Standup (special)")
        rule.onNodeWithText("Save").performClick()
        // A repeating event asks which events to change.
        rule.waitUntilAtLeastOneExists(hasText("Edit repeating event"), 10_000)
        rule.onNodeWithText("This event").performClick()
        rule.onAllNodesWithText("Save").onLast().performClick()
        rule.waitUntilAtLeastOneExists(hasText("Standup (special)"), 20_000)
        // The rest of the series is untouched.
        rule.waitUntilAtLeastOneExists(hasText("Standup (ui test)"), 20_000)
    }

    @Test fun deleteAndUndo() {
        seed("""{"title":"Doomed (ui test)","start":"${tomorrow}T11:00:00","end":"${tomorrow}T12:00:00","tz":"UTC"}""")
        launchAndSignIn()
        rule.waitUntilAtLeastOneExists(hasText("Doomed (ui test)"), 20_000)
        rule.onNodeWithText("Doomed (ui test)").performClick()
        rule.onNodeWithText("Delete").performClick()
        rule.onNodeWithText("Delete event?").assertExistsCompat()
        rule.onAllNodesWithText("Delete").onLast().performClick()
        rule.waitUntilAtLeastOneExists(hasText("Event deleted"), 20_000)
        rule.waitUntilDoesNotExist(hasText("Doomed (ui test)"), 20_000)
        rule.onNodeWithText("Undo").performClick()
        rule.waitUntilAtLeastOneExists(hasText("Event restored"), 20_000)
        rule.waitUntilAtLeastOneExists(hasText("Doomed (ui test)"), 20_000)
    }

    private fun androidx.compose.ui.test.SemanticsNodeInteraction.assertExistsCompat() = assertExists()
}

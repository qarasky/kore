package dev.qarasky.korecalendar.contract

import dev.qarasky.korecalendar.data.ApiJson
import dev.qarasky.korecalendar.data.ServerUrl
import java.io.File
import java.net.ServerSocket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assume

/**
 * Runs the real KoreCalendar server (built from ../../api) on a free port with a fresh data
 * directory, so the app's networking and sync are tested against the API it will really meet.
 * Without `go` on the PATH the tests are skipped locally, and fail when CI is set.
 */
object ServerHarness {
    private val apiDir = File("../../api").canonicalFile

    private val binary: File? by lazy {
        if (!goAvailable()) return@lazy null
        val out = File("build/contract").apply { mkdirs() }.canonicalFile.resolve("korecalendar")
        val p = ProcessBuilder("go", "build", "-o", out.path, "./cmd/korecalendar")
            .directory(apiDir).redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        check(p.waitFor(5, TimeUnit.MINUTES) && p.exitValue() == 0) { "go build failed:\n$log" }
        out
    }

    private fun goAvailable(): Boolean = try {
        val p = ProcessBuilder("go", "version").redirectErrorStream(true).start()
        p.inputStream.readBytes()
        p.waitFor() == 0
    } catch (_: Exception) {
        false
    }

    /** Starts a server, or skips the test (fails it under CI) when Go is not installed. */
    fun start(): RunningServer {
        val bin = binary
        if (bin == null) {
            if (System.getenv("CI") != null) error("CI is set but `go` is not on the PATH: the contract tests cannot run")
            Assume.assumeTrue("go is not installed; skipping the contract tests", false)
        }
        val data = Files.createTempDirectory("kc-contract").toFile()
        val port = ServerSocket(0).use { it.localPort }
        val env = mapOf("KORECAL_DATA_DIR" to data.path, "KORECAL_BIND" to "127.0.0.1", "KORECAL_PORT" to port.toString())
        fun run(vararg args: String): Process = ProcessBuilder(bin!!.path, *args).apply {
            environment().putAll(env)
            redirectErrorStream(true)
        }.start()
        val init = run("init")
        val initLog = init.inputStream.bufferedReader().readText()
        check(init.waitFor() == 0) { "korecalendar init failed:\n$initLog" }
        val serve = run("serve")
        Thread { serve.inputStream.bufferedReader().forEachLine { /* drain */ } }.apply { isDaemon = true }.start()
        val base = "http://127.0.0.1:$port"
        val http = HttpClient.newHttpClient()
        val deadline = System.currentTimeMillis() + 20_000
        while (true) {
            try {
                val r = http.send(HttpRequest.newBuilder(URI("$base/api/healthz")).build(), HttpResponse.BodyHandlers.ofString())
                if (r.statusCode() == 200) break
            } catch (_: Exception) {
            }
            check(System.currentTimeMillis() < deadline && serve.isAlive) { "the server did not become healthy" }
            Thread.sleep(100)
        }
        val server = RunningServer(base, serve, data, http)
        server.setup()
        return server
    }
}

class RunningServer(val base: String, private val process: Process, private val data: File, private val http: HttpClient) : AutoCloseable {
    val email = "owner@korecal.test"
    lateinit var ownerSession: String
        private set
    val url get() = ServerUrl(base, cleartext = true)

    /**
     * Kore ID is the only sign-in, and a contract test cannot drive a browser to
     * a real provider. Seed the owner and a session directly in the server's
     * SQLite database (the same SHA-256-at-rest rule the API uses).
     */
    internal fun setup() {
        val id = UUID.randomUUID().toString().replace("-", "")
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        ownerSession = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        val hash = MessageDigest.getInstance("SHA-256").digest(ownerSession.toByteArray()).joinToString("") { "%02x".format(it) }
        val now = System.currentTimeMillis() / 1000
        val sql = """
            INSERT INTO users(id,email,pw_hash,role,timezone,created_at,oidc_sub) VALUES('$id','$email','!','admin','UTC',$now,'contract-owner');
            INSERT INTO calendars(id,user_id,name,color,created_at) VALUES('${UUID.randomUUID()}', '$id', 'Personal', '#5b8def', $now);
            INSERT INTO sessions(token_hash,user_id,expires_at,id_token,oidc_sid) VALUES('$hash','$id',${now + 3600},'','');
        """.trimIndent()
        val p = ProcessBuilder("sqlite3", File(data, "korecal.db").path, sql).redirectErrorStream(true).start()
        val log = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS) && p.exitValue() == 0) { "seeding the test database failed (is sqlite3 installed?):\n$log" }
    }

    /** A plain REST call as the owner (or as [token]); returns status and body. */
    fun call(method: String, path: String, body: String? = null, token: String? = ownerSession): Pair<Int, String> {
        val b = HttpRequest.newBuilder(URI(base + path)).header("Content-Type", "application/json")
        if (token != null) b.header("Authorization", "Bearer $token")
        b.method(method, if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body))
        val r = http.send(b.build(), HttpResponse.BodyHandlers.ofString())
        return r.statusCode() to r.body()
    }

    fun json(method: String, path: String, body: String? = null, expect: Int = 200): JsonObject {
        val (status, text) = call(method, path, body)
        check(status == expect) { "$method $path → $status $text" }
        return ApiJson.parseToJsonElement(text).jsonObject
    }

    fun createEvent(json: String): JsonObject = json("POST", "/api/events", json, expect = 201)

    override fun close() {
        process.destroy()
        process.waitFor(10, TimeUnit.SECONDS)
        data.deleteRecursively()
    }
}

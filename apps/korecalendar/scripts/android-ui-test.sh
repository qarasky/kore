#!/usr/bin/env bash
# Runs the Android app's device tests, including the UI flows against a real server.
#
# Builds the server, starts it on a free port with a fresh data directory (an emulator reaches the
# computer's loopback as 10.0.2.2; set KORECAL_UI_TEST_BIND=0.0.0.0 and the address for a real phone), seeds the owner
# and a session (sign-in itself is Kore ID only and needs a browser), then runs `connectedDebugAndroidTest` on the attached
# emulator or phone with the server's address, the owner's email and that session as instrumentation arguments.
# Set KORECAL_UI_TEST_CLASS to run one test class. Needs `go`, `sqlite3`, a running emulator/device (adb), and the Android SDK.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
server_pid=""
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

port="${KORECAL_UI_TEST_PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("", 0)); print(s.getsockname()[1])')}"
email="owner@korecal.test"

(cd "$root/api" && go build -o "$work/korecalendar" ./cmd/korecalendar)
export KORECAL_DATA_DIR="$work/data" KORECAL_BIND="${KORECAL_UI_TEST_BIND:-127.0.0.1}" KORECAL_PORT="$port"
mkdir -p "$KORECAL_DATA_DIR"
"$work/korecalendar" init >/dev/null
"$work/korecalendar" serve >"$work/server.log" 2>&1 &
server_pid=$!

for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1 && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$work/server.log"; echo "the server stopped"; exit 1; }
  sleep 0.2
done
# Kore ID is browser-only, so seed the owner and a session in the server's database.
session="$(python3 - "$KORECAL_DATA_DIR/korecal.db" "$email" <<'PY'
import hashlib, secrets, sqlite3, sys, time, uuid
db, email = sys.argv[1], sys.argv[2]
token = secrets.token_urlsafe(32)
user_id = uuid.uuid4().hex
now = int(time.time())
con = sqlite3.connect(db)
con.execute("INSERT INTO users(id,email,pw_hash,role,timezone,created_at,oidc_sub) VALUES(?,?,?,?,?,?,?)",
            (user_id, email, "!", "admin", "UTC", now, "ui-test-owner"))
con.execute("INSERT INTO calendars(id,user_id,name,color,created_at) VALUES(?,?,?,?,?)",
            (uuid.uuid4().hex, user_id, "Personal", "#5b8def", now))
con.execute("INSERT INTO sessions(token_hash,user_id,expires_at,id_token,oidc_sid) VALUES(?,?,?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), user_id, now + 3600, "", ""))
con.commit()
con.close()
print(token)
PY
)"

cd "$root/android"
./gradlew --no-daemon connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.server=http://10.0.2.2:$port" \
  "-Pandroid.testInstrumentationRunnerArguments.email=$email" \
  "-Pandroid.testInstrumentationRunnerArguments.session=$session" \
  ${KORECAL_UI_TEST_CLASS:+"-Pandroid.testInstrumentationRunnerArguments.class=$KORECAL_UI_TEST_CLASS"}

# Gradle can report success when the tests never ran (for example when the app could not be installed
# over a differently signed one), so count the results.
all="$(find "$root/android/app/build/outputs/androidTest-results" -name 'TEST-*.xml' -print0 2>/dev/null | xargs -0 cat 2>/dev/null || true)"
[ -n "$all" ] || { echo "no device test results were written: the tests did not run"; exit 1; }
tests="$(echo "$all" | grep -o '<testsuite [^>]*' | grep -o ' tests="[0-9]*"' | grep -o '[0-9]*' | paste -sd+ - | bc)"
bad="$(echo "$all" | grep -o '<testsuite [^>]*' | grep -o -E ' (failures|errors)="[0-9]*"' | grep -o '[0-9]*' | paste -sd+ - | bc)"
echo "device tests: $tests run, $bad failed"
[ "${tests:-0}" -gt 0 ] && [ "${bad:-1}" -eq 0 ]

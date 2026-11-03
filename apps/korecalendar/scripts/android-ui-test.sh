#!/usr/bin/env bash
# Runs the Android app's device tests, including the UI flows against a real server.
#
# Builds the server, starts it on a free port with a fresh data directory (reachable from the
# emulator as 10.0.2.2), creates the owner, then runs `connectedDebugAndroidTest` on the attached
# emulator or phone with the server's address and the owner's login as instrumentation arguments.
# Needs `go`, a running emulator/device (adb), and the Android SDK.
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
password="owner-password-123"

(cd "$root/api" && go build -o "$work/korecalendar" ./cmd/korecalendar)
export KORECAL_DATA_DIR="$work/data" KORECAL_BIND=0.0.0.0 KORECAL_PORT="$port"
mkdir -p "$KORECAL_DATA_DIR"
"$work/korecalendar" init >/dev/null
"$work/korecalendar" serve >"$work/server.log" 2>&1 &
server_pid=$!

for _ in $(seq 1 100); do
  curl -fsS "http://127.0.0.1:$port/api/healthz" >/dev/null 2>&1 && break
  kill -0 "$server_pid" 2>/dev/null || { cat "$work/server.log"; echo "the server stopped"; exit 1; }
  sleep 0.2
done
curl -fsS -X POST "http://127.0.0.1:$port/api/setup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$password\"}" >/dev/null

cd "$root/android"
./gradlew --no-daemon connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.server=http://10.0.2.2:$port" \
  "-Pandroid.testInstrumentationRunnerArguments.email=$email" \
  "-Pandroid.testInstrumentationRunnerArguments.password=$password"

# Gradle can report success when the tests never ran (for example when the app could not be installed
# over a differently signed one), so count the results.
all="$(find "$root/android/app/build/outputs/androidTest-results" -name 'TEST-*.xml' -print0 2>/dev/null | xargs -0 cat 2>/dev/null || true)"
[ -n "$all" ] || { echo "no device test results were written: the tests did not run"; exit 1; }
tests="$(echo "$all" | grep -o '<testsuite [^>]*' | grep -o ' tests="[0-9]*"' | grep -o '[0-9]*' | paste -sd+ - | bc)"
bad="$(echo "$all" | grep -o '<testsuite [^>]*' | grep -o -E ' (failures|errors)="[0-9]*"' | grep -o '[0-9]*' | paste -sd+ - | bc)"
echo "device tests: $tests run, $bad failed"
[ "${tests:-0}" -gt 0 ] && [ "${bad:-1}" -eq 0 ]

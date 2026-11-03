#!/usr/bin/env bash
# Tests for the Android version code scheme in scripts/release-android.sh.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
fail=0
code() { scripts/release-android.sh --print-code "$1" 2>/dev/null; }
check() { # check DESCRIPTION EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$2', got '$3'"; fail=1; fi
}

check "0.1.0"        10099   "$(code 0.1.0)"
check "1.0.0-rc.1"   1000001 "$(code 1.0.0-rc.1)"
check "1.0.0"        1000099 "$(code 1.0.0)"

prev=-1
for v in 0.1.0 0.1.1 0.2.0-rc.1 0.2.0-rc.2 0.2.0 0.10.0 1.0.0-rc.1 1.0.0 1.0.1 1.2.3 2.0.0; do
  c="$(code "$v")"
  if [ -n "$c" ] && [ "$c" -gt "$prev" ]; then echo "ok   $v ($c) > $prev"; else echo "FAIL $v ($c) is not greater than $prev"; fail=1; fi
  prev="${c:-$prev}"
done

for bad in abc 1.0 v1.0.0 1.0.0-beta 1.0.0-rc.0 1.0.0-rc.99 01.0.0 1.0.0-rc.1.2 2000.0.0 0.100.0 0.0.100 ""; do
  if scripts/release-android.sh --print-code "$bad" >/dev/null 2>&1; then echo "FAIL '$bad' was accepted"; fail=1; else echo "ok   '$bad' rejected"; fi
done

exit $fail

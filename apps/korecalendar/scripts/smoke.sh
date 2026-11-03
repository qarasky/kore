#!/usr/bin/env bash
# Starts the whole stack from the api and web images tagged $KORECAL_VERSION in a
# throwaway project and checks that it answers. The release workflow runs it on
# the images it just published; run it by hand to try any tag:
#
#   KORECAL_VERSION=0.1.0 scripts/smoke.sh          # pulls ghcr.io/qarasky/korecalendar-{api,web}:0.1.0
#   KORECAL_VERSION=latest SMOKE_PULL=0 scripts/smoke.sh   # use the images already on this machine
#
# When the tag is a release number (1.2.3), the api binary must report exactly that.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${KORECAL_VERSION:-latest}"
PORT="${SMOKE_PORT:-18599}"
WORK="$(mktemp -d)"
export KORECAL_DATA_DIR="$WORK/data"
export KORECAL_VERSION="$VERSION"
export KORECAL_BIND=127.0.0.1
export KORECAL_PORT="$PORT"
KORECAL_UID="$(id -u)"
KORECAL_GID="$(id -g)"
export KORECAL_UID KORECAL_GID
# Not the default subnet, so a running installation does not collide with the test.
export KORECAL_SUBNET="${SMOKE_SUBNET:-172.31.254.0/24}"
mkdir -p "$KORECAL_DATA_DIR"

dc() { docker compose -p korecal-smoke "$@"; }
cleanup() {
  status=$?
  [ "$status" = 0 ] || dc logs --tail 40 2>/dev/null || true
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

fail() { echo "smoke: $*" >&2; exit 1; }
status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

if [ "${SMOKE_PULL:-1}" = 1 ]; then
  echo "smoke: pulling $VERSION"
  dc pull --quiet api web caddy
fi

if [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  got="$(dc run --rm -T --no-deps api korecalendar version </dev/null)"
  case "$got" in
    "korecalendar $VERSION "* | "korecalendar $VERSION") ;;
    *) fail "the api image tagged $VERSION reports \"$got\"" ;;
  esac
  echo "smoke: $got"
fi

dc run --rm -T --no-deps api korecalendar init </dev/null
dc up -d --wait --no-build </dev/null

base="http://127.0.0.1:$PORT"
[ "$(status_of "$base/api/healthz")" = 200 ] || fail "GET /api/healthz did not answer 200"
# A fresh install redirects /login to the first-run page; follow it.
[ "$(status_of -L "$base/login")" = 200 ] || fail "GET /login did not end in 200"
[ "$(status_of "$base/dav/")" = 401 ] || fail "GET /dav/ without credentials did not answer 401"
echo "smoke: ok ($VERSION)"

#!/usr/bin/env bash
# Starts the whole stack from the api and web images tagged $KORE_VERSION in a
# throwaway project and checks that it answers. The images workflow runs it on
# the images it just published; run it by hand to try any tag:
#
#   KORE_VERSION=0.1.0 scripts/smoke.sh                 # pulls ghcr.io/qarasky/kore-{api,web}:0.1.0
#   KORE_VERSION=latest SMOKE_PULL=0 scripts/smoke.sh   # use the images already on this machine
#
# When the tag is a release number (1.2.3), the api binary must report exactly that.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${KORE_VERSION:-latest}"
PORT="${SMOKE_PORT:-18598}"
WORK="$(mktemp -d)"
export KORE_DATA_DIR="$WORK/data"
export KORE_VERSION="$VERSION"
export KORE_BIND=127.0.0.1
export KORE_PORT="$PORT"
export KORE_PUBLIC_URL="http://127.0.0.1:$PORT"
# Discovery is lazy: any issuer URL is enough for the stack to boot.
export KORE_OIDC_ISSUER=https://id.example.com
export KORE_OIDC_OWNER_EMAIL=smoke@example.com
KORE_UID="$(id -u)"
KORE_GID="$(id -g)"
export KORE_UID KORE_GID
# Not the default subnet, so a running installation does not collide with the test.
export KORE_SUBNET="${SMOKE_SUBNET:-172.31.253.0/24}"
mkdir -p "$KORE_DATA_DIR"

dc() { docker compose -p kore-smoke "$@"; }
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
  got="$(dc run --rm -T --no-deps api kore version </dev/null)"
  case "$got" in
    "kore $VERSION "* | "kore $VERSION") ;;
    *) fail "the api image tagged $VERSION reports \"$got\"" ;;
  esac
  echo "smoke: $got"
fi

dc run --rm -T --no-deps api kore init </dev/null
dc up -d --wait --no-build </dev/null

base="http://127.0.0.1:$PORT"
[ "$(status_of "$base/api/healthz")" = 200 ] || fail "GET /api/healthz did not answer 200"
[ "$(status_of "$base/login")" = 200 ] || fail "GET /login did not answer 200"
curl -fsS --max-time 10 "$base/api/auth/config" | grep -q '"oidc":true' || fail "GET /api/auth/config unexpected"
[ "$(status_of "$base/api/auth/login" -X POST)" = 404 ] || fail "POST /api/auth/login is not gone"
[ "$(status_of "$base/api/auth/me")" = 401 ] || fail "GET /api/auth/me without a session did not answer 401"
echo "smoke: ok ($VERSION)"

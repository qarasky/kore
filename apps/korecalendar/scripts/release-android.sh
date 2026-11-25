#!/usr/bin/env bash
# Cuts an Android release: writes android/version.properties, commits it, and
# creates the annotated tag android-vX.Y.Z. It does not push; it prints the
# command. Pushing the tag is what builds, signs and publishes the APK
# (see docs/releasing.md).
#
#   scripts/release-android.sh 0.2.0
#   scripts/release-android.sh 1.0.0-rc.1     # a pre-release
#   scripts/release-android.sh --print-code 1.0.0   # just the Android versionCode
#
# versionCode = major*1000000 + minor*10000 + patch*100 + slot, where slot is 99
# for a final release and N (1..98) for -rc.N. Android only installs an update
# whose code is higher, so a release candidate sorts below its final release.
set -euo pipefail

die() { echo "release-android: $*" >&2; exit 1; }

# version_code VERSION: prints the code, or fails for a malformed version.
version_code() {
  local re='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.([1-9][0-9]?))?$'
  [[ "$1" =~ $re ]] || die "not a version: '$1' (use MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N, no leading v)"
  local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}" rc="${BASH_REMATCH[5]:-}"
  [ "$major" -lt 2000 ] && [ "$minor" -lt 100 ] && [ "$patch" -lt 100 ] || die "version out of range: '$1' (major < 2000, minor and patch < 100)"
  local slot=99
  if [ -n "$rc" ]; then
    [ "$rc" -le 98 ] || die "release candidate number out of range: '$1' (1..98)"
    slot="$rc"
  fi
  echo $(( major * 1000000 + minor * 10000 + patch * 100 + slot ))
}

if [ "${1:-}" = "--print-code" ]; then
  version_code "${2:-}"
  exit 0
fi

cd "$(dirname "$0")/.." || exit 1
V="${1:-}"
CODE="$(version_code "$V")"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run this on main"
[ -z "$(git status --porcelain)" ] || die "the working tree is not clean"
git fetch --quiet origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not the same as origin/main (pull or push first)"
git rev-parse -q --verify "refs/tags/android-v$V" >/dev/null && die "tag android-v$V already exists"

printf '# Written by scripts/release-android.sh. Do not edit by hand.\nversionName=%s\nversionCode=%s\n' "$V" "$CODE" > android/version.properties
if [ -n "$(git status --porcelain android/version.properties)" ]; then
  git add android/version.properties
  git commit -q -m "android release: v$V"
fi
git tag -a "android-v$V" -m "KoreCalendar for Android $V"
echo "release-android: created android-v$V at $(git rev-parse --short HEAD) (versionCode $CODE)"
echo "release-android: publish it with:  git push origin main android-v$V"

#!/usr/bin/env bash
# Cuts a server release: bumps web/package.json, commits, and creates the annotated
# tag korecalendar-vX.Y.Z (the Kore monorepo holds every app's tags). It does not push; it prints the command. Pushing the tag is what
# publishes the images (see docs/releasing.md).
#
#   scripts/release.sh 0.2.0
#   scripts/release.sh 1.0.0-rc.1      # a pre-release: never becomes "latest"
set -euo pipefail

cd "$(dirname "$0")/.."
die() { echo "release: $*" >&2; exit 1; }

V="${1:-}"
[[ "$V" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]] || die "usage: scripts/release.sh MAJOR.MINOR.PATCH[-prerelease] (no leading v)"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "run this on main"
[ -z "$(git status --porcelain)" ] || die "the working tree is not clean"
git fetch --quiet origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not the same as origin/main (pull or push first)"
TAG="korecalendar-v$V"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists"

current="$(node -p "require('./web/package.json').version")"
if [ "$current" != "$V" ]; then
  node -e 'const f="web/package.json",fs=require("fs"),p=JSON.parse(fs.readFileSync(f));p.version=process.argv[1];fs.writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$V"
  # The monorepo's bun.lock records each workspace's version.
  (cd ../.. && bun install --silent)
  git add web/package.json ../../bun.lock
  git commit -q -m "release: korecalendar v$V"
fi
git tag -a "$TAG" -m "KoreCalendar $V"
echo "release: created $TAG at $(git rev-parse --short HEAD)"
echo "release: publish it with:  git push origin main $TAG"

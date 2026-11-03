#!/usr/bin/env bash
# Cuts a server release: bumps web/package.json, commits, and creates the annotated
# tag vX.Y.Z. It does not push; it prints the command. Pushing the tag is what
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
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && die "tag v$V already exists"

current="$(node -p "require('./web/package.json').version")"
if [ "$current" != "$V" ]; then
  (cd web && npm version "$V" --no-git-tag-version --allow-same-version >/dev/null)
  git add web/package.json web/package-lock.json
  git commit -q -m "release: v$V"
fi
git tag -a "v$V" -m "KoreCalendar $V"
echo "release: created v$V at $(git rev-parse --short HEAD)"
echo "release: publish it with:  git push origin main v$V"

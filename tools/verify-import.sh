#!/usr/bin/env bash
# Checks that qarasky/<repo> was imported into <target-dir> faithfully: same tree as the
# source's default branch, every source commit present, every tag present with its prefix.
# Usage: tools/verify-import.sh <github-repo> <target-dir> <tag-prefix>
set -euo pipefail
repo=$1 target=$2 prefix=$3
root=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git clone -q "https://github.com/qarasky/$repo.git" "$tmp/src"
fail=0
src_tree=$(git -C "$tmp/src" rev-parse 'HEAD^{tree}')
dst_tree=$(git -C "$root" rev-parse -q --verify "HEAD:$target" || echo missing)
[ "$src_tree" = "$dst_tree" ] || { echo "FAIL tree: source $src_tree, $target $dst_tree"; fail=1; }
src_n=$(git -C "$tmp/src" rev-list --count HEAD)
# Count from the import merge's second parent: a path-limited rev-list would skip merges
# that left the tree unchanged.
merge=$(git -C "$root" log --merges --format=%H -1 --grep="^chore: import qarasky/$repo into $target\$" HEAD)
dst_n=$([ -n "$merge" ] && git -C "$root" rev-list --count "$merge^2" || echo 0)
[ "$src_n" = "$dst_n" ] || { echo "FAIL commits: source $src_n, $target $dst_n"; fail=1; }
for t in $(git -C "$tmp/src" tag -l); do
  git -C "$root" rev-parse -q --verify "refs/tags/$prefix-$t" >/dev/null || { echo "FAIL tag: $prefix-$t missing"; fail=1; }
done
[ $fail = 0 ] && echo "OK $repo -> $target ($src_n commits, $(git -C "$tmp/src" tag -l | wc -l) tags)"
exit $fail

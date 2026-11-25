#!/usr/bin/env bash
# Imports qarasky/<repo> into this monorepo with its full history, under <target-dir>.
# Tags are renamed <tag-prefix>-<tag>. A non-default branch with commits of its own (ahead of the
# default branch, with a non-empty diff since they split) is kept as import/<tag-prefix>/<branch>.
# Usage: tools/import-repo.sh <github-repo> <target-dir> <tag-prefix>
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <github-repo> <target-dir> <tag-prefix>" >&2; exit 2; }
repo=$1 target=$2 prefix=$3
root=$(git rev-parse --show-toplevel)
[ -z "$(git -C "$root" status --porcelain)" ] || { echo "working tree is dirty; commit or stash first" >&2; exit 1; }
[ ! -e "$root/$target" ] || { echo "$target already exists" >&2; exit 1; }
command -v git-filter-repo >/dev/null || { echo "git-filter-repo is not installed" >&2; exit 1; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
src=$tmp/src
git clone -q "https://github.com/qarasky/$repo.git" "$src"
default=$(git -C "$src" symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||')

# Keep branches that carry commits the default branch doesn't have.
kept=()
for ref in $(git -C "$src" for-each-ref --format='%(refname:short)' refs/remotes/origin/); do
  b=${ref#origin/}
  [ "$b" = HEAD ] || [ "$b" = origin ] || [ "$b" = "$default" ] && continue
  # Ahead of the default branch, with changes of its own since they split.
  if [ "$(git -C "$src" rev-list --count "origin/$default..$ref")" -gt 0 ] &&
     ! git -C "$src" diff --quiet "origin/$default...$ref"; then
    git -C "$src" branch -q "import/$prefix/$b" "$ref"; kept+=("import/$prefix/$b")
  fi
done

# --force: $src is our own throwaway clone; the branches made above make it look non-fresh.
git -C "$src" filter-repo --quiet --force --to-subdirectory-filter "$target" --tag-rename "":"$prefix-"

git -C "$root" fetch -q "$src" "+refs/heads/*:refs/remotes/import-src/*" "+refs/tags/*:refs/tags/*"
git -C "$root" merge -q --allow-unrelated-histories --no-edit \
  -m "chore: import qarasky/$repo into $target" "import-src/$default"
for b in "${kept[@]}"; do git -C "$root" branch -q -f "$b" "import-src/$b"; done
git -C "$root" for-each-ref --format='%(refname)' refs/remotes/import-src/ | xargs -r -n1 git -C "$root" update-ref -d
echo "imported $repo ($default) into $target; kept branches: ${kept[*]:-none}"

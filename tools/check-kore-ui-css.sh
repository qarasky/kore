#!/usr/bin/env bash
# Fails unless an app's built CSS contains classes that only kore-ui's own source uses,
# i.e. Tailwind scanned packages/kore-ui/src. A miss means unstyled kore-ui components.
# Usage: tools/check-kore-ui-css.sh <built-css-dir>
set -euo pipefail
dir=${1:?usage: $0 <built-css-dir>}
classes=(
  animate-kore-indeterminate  # Meter.tsx (indeterminate bar)
  bg-status-down-muted        # StatusDot.tsx (down state)
  w-sidebar-collapsed         # AppShell.tsx (collapsed sidebar)
)
css=$(find "$dir" -name '*.css' -print0 | xargs -0 cat 2>/dev/null || true)
[ -n "$css" ] || { echo "FAIL: no CSS under $dir" >&2; exit 1; }
fail=0
for c in "${classes[@]}"; do
  grep -qF ".$c" <<<"$css" || { echo "FAIL: .$c missing from $dir" >&2; fail=1; }
done
[ $fail = 0 ] && echo "OK: kore-ui classes present in $dir"
exit $fail

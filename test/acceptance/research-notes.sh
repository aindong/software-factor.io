#!/usr/bin/env bash
# Research notes exist, cite their sources, and cover the facts later tasks depend on.
set -u
cd "$(dirname "$0")/../.."
fail=0
bad() { echo "FAIL: $*"; fail=1; }

for f in prior-art-own prior-art-external agent-clis workflow-formats; do
  p="docs/research/$f.md"
  [ -f "$p" ] || { bad "$p missing"; continue; }
  [ "$(wc -c < "$p")" -le 20000 ] || bad "$p is over 20 KB"
  grep -q "($f.md)" docs/research/README.md 2>/dev/null || bad "README.md does not link $f.md"
  grep -q '^## What we take' "$p" || bad "$p has no 'What we take' section"
  n=$(sed -n '/^## Sources/,$p' "$p" | grep -cE '^- .*(https?://|/Volumes/)')
  [ "$n" -ge 3 ] || bad "$p lists $n sources, needs 3"
  grep -nE 'TODO|TBD|—' "$p" | head -3 | while read -r l; do echo "FAIL: $p: $l"; done
  grep -qE 'TODO|TBD|—' "$p" && fail=1
  # every other section cites a source inline or says it was not verified
  awk -v p="$p" '
    function flush() { if (name != "" && !ok) { print "FAIL: " p ": section \"" name "\" cites no source"; bad = 1 } }
    /^## / { flush(); name = substr($0, 4); ok = (name ~ /^(Sources|What we take|What we avoid)/) ; next }
    /https?:\/\/|\/Volumes\/|Not verified|Checked locally/ { ok = 1 }
    END { flush(); exit bad }' "$p" || fail=1
done

c=docs/research/agent-clis.md
if [ -f "$c" ]; then
  for h in 'Claude Code' 'Codex' 'Kimi' 'Skills' 'MCP servers per run'; do
    grep -q "^## $h" "$c" || bad "$c has no section starting '## $h'"
  done
  for h in 'Claude Code' 'Codex'; do
    awk -v h="$h" '$0 ~ "^## " h {on=1; next} /^## /{on=0} on && /Checked locally/ {found=1} END{exit !found}' "$c" \
      || bad "$c section '$h' has no 'Checked locally' line"
  done
fi

[ "$fail" -eq 0 ] && echo "research notes: ok"
exit "$fail"

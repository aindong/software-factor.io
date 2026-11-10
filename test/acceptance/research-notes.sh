#!/usr/bin/env bash
# Research notes exist, cite their sources, and cover the facts later tasks depend on.
set -u
cd "$(dirname "$0")/../.."
fail=0
bad() { echo "FAIL: $*"; fail=1; }
# body of one "## <heading prefix>" section of a file
section() { awk -v h="$2" '$0 ~ "^## " h {on=1; next} /^## /{on=0} on' "$1"; }

r=docs/research/README.md
[ -f "$r" ] || bad "$r missing"
[ -f "$r" ] && { [ "$(wc -c < "$r")" -le 20000 ] || bad "$r is over 20 KB"; }

for f in prior-art-own prior-art-external agent-clis workflow-formats; do
  p="docs/research/$f.md"
  # the notes on the owner's own earlier projects are not in the repository: they are checked where they are
  if [ "$f" = prior-art-own ]; then
    [ -f "$p" ] || continue
  else
    grep -q "($f.md)" "$r" 2>/dev/null || bad "README.md does not link $f.md"
  fi
  [ -f "$p" ] || { bad "$p missing"; continue; }
  [ "$(wc -c < "$p")" -le 20000 ] || bad "$p is over 20 KB"
  grep -q '^## What we take' "$p" || bad "$p has no 'What we take' section"
  n=$(section "$p" Sources | grep -cE '^- .*(https?://|/Volumes/|\.agent/)')
  [ "$n" -ge 3 ] || bad "$p lists $n sources, needs 3"
  # every section but the two summaries and Sources cites a source or says it was not verified
  awk -v p="$p" '
    function flush() { if (name != "" && !ok) { print "FAIL: " p ": section \"" name "\" cites no source"; bad = 1 } }
    /^## / { flush(); name = substr($0, 4); ok = (name ~ /^(Sources|What we take)/); next }
    /https?:\/\/|\/Volumes\/|\.agent\/|Not verified/ { ok = 1 }
    END { flush(); exit bad }' "$p" || fail=1
done

for p in docs/research/*.md; do
  [ -f "$p" ] || continue
  if grep -qE 'TODO|TBD|—' "$p"; then
    grep -nE 'TODO|TBD|—' "$p" | head -3
    bad "$p has a TODO, TBD or em dash"
  fi
done

c=docs/research/agent-clis.md
if [ -f "$c" ]; then
  for h in 'Claude Code' 'Codex' 'Kimi' 'Skills' 'MCP servers per run'; do
    grep -q "^## $h" "$c" || bad "$c has no section starting '## $h'"
  done
  section "$c" Skills | grep -q 'npx skills' || bad "$c Skills section never mentions npx skills"
  for h in 'Claude Code' 'Codex'; do
    # "Checked locally" must be followed by a code block that quotes the CLI's own help
    section "$c" "$h" | awk '/Checked locally/{seen=1} seen && /^```/{inblock=!inblock; next} seen && inblock && /[Uu]sage/{found=1} END{exit !found}' \
      || bad "$c section '$h' has no quoted CLI help after 'Checked locally'"
  done
fi

[ "$fail" -eq 0 ] && echo "research notes: ok"
exit "$fail"

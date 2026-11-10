#!/usr/bin/env bash
# The glossary defines the core terms, and every spec decision has exactly one decision record.
set -u
cd "$(dirname "$0")/../.."
fail=0
bad() { echo "FAIL: $*"; fail=1; }
# body of one "## <heading>" section of a file
section() { awk -v h="$2" '$0 == "## " h {on=1; next} /^## /{on=0} on' "$1"; }

c=CONTEXT.md
if [ -f "$c" ]; then
  for t in factory workflow lane collector gate evidence hand-off account role slot plugin; do
    # the first non-blank line after the term's heading must be prose, not another heading
    awk -v t="$t" 'tolower($0) == "### " t {on=1; next} on && NF {ok = ($0 !~ /^#/); exit} END{exit !ok}' "$c" \
      || bad "$c does not define '$t' under its own ### heading"
  done
else
  bad "$c missing"
fi

spec=.agent/spec.md
want=$(grep -oE '^- \*\*D[0-9]+ ' "$spec" | grep -oE 'D[0-9]+' | sort -u)
[ -n "$want" ] || bad "no decisions found in $spec"
for d in D12 D13; do echo "$want" | grep -qx "$d" || bad "$spec has no $d"; done

have=""
for a in docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
  [ -f "$a" ] || { bad "no ADR files in docs/adr/"; break; }
  d=$(head -1 "$a" | grep -oE '\bD[0-9]+\b' | head -1)
  [ -n "$d" ] || { bad "$a: first line names no decision number"; continue; }
  have="$have$d
"
  echo "$want" | grep -qx "$d" || bad "$a names $d, which $spec does not have"
  [ "$(wc -c < "$a")" -le 20000 ] || bad "$a is over 20 KB"
  for s in Status Context Decision Consequences; do
    section "$a" "$s" | grep -q '[^[:space:]]' || bad "$a: section '$s' is missing or empty"
  done
done
for d in $want; do
  n=$(printf '%s' "$have" | grep -cx "$d")
  [ "$n" -eq 1 ] || bad "$d has $n ADRs, needs exactly 1"
done

for p in "$c" docs/adr/*.md; do
  [ -f "$p" ] || continue
  if grep -qE 'TODO|TBD|—' "$p"; then
    grep -nE 'TODO|TBD|—' "$p" | head -3
    bad "$p has a TODO, TBD or em dash"
  fi
done

[ "$fail" -eq 0 ] && echo "context and ADRs: ok"
exit "$fail"

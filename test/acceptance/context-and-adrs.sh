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

# The spec is one of the goal run's own records, which are not in the repository. Where it is
# (the machine the factory is built on), the records are held to it. In a clone they are held to themselves.
spec=.agent/spec.md
want=""
if [ -f "$spec" ]; then
  want=$(grep -oE '^- \*\*D[0-9]+ ' "$spec" | grep -oE 'D[0-9]+' | sort -u)
  [ -n "$want" ] || bad "no decisions found in $spec"
  for d in D12 D13; do echo "$want" | grep -qx "$d" || bad "$spec has no $d"; done
  # the two decisions research added, by subject and not only by number
  grep -E '^- \*\*D12 ' "$spec" | grep -qi 'workflow' || bad "$spec: D12 is not the workflow shape decision"
  grep -E '^- \*\*D13 ' "$spec" | grep -i 'claim' | grep -qi 'landed' || bad "$spec: D13 is not claim before spawn with landed work"
  grep -E '^- \*\*D3 ' -A6 "$spec" | grep -q 'KIMI_CODE_HOME' || bad "$spec: D3 does not name Kimi Code's profile variable"
fi
awk 'FNR == 1' docs/adr/[0-9]*.md 2>/dev/null | grep -E '\(D12\)' | grep -qi 'lanes' || bad "the D12 ADR is not about the workflow shape"
awk 'FNR == 1' docs/adr/[0-9]*.md 2>/dev/null | grep -E '\(D13\)' | grep -qi 'claim' || bad "the D13 ADR is not about claiming before spawning"
for a in docs/adr/*.md; do
  case "$a" in docs/adr/[0-9][0-9][0-9][0-9]-*.md) ;; *) [ -f "$a" ] && bad "$a is not named <4 digits>-<slug>.md" ;; esac
done

have=""
for a in docs/adr/[0-9][0-9][0-9][0-9]-*.md; do
  [ -f "$a" ] || { bad "no ADR files in docs/adr/"; break; }
  d=$(head -1 "$a" | grep -oE '\bD[0-9]+\b' | head -1)
  [ -n "$d" ] || { bad "$a: first line names no decision number"; continue; }
  have="$have$d
"
  [ -z "$want" ] || echo "$want" | grep -qx "$d" || bad "$a names $d, which $spec does not have"
  [ "$(wc -c < "$a")" -le 20000 ] || bad "$a is over 20 KB"
  for s in Status Context Decision Consequences; do
    section "$a" "$s" | grep -q '[^[:space:]]' || bad "$a: section '$s' is missing or empty"
  done
done
for d in $want; do
  n=$(printf '%s' "$have" | grep -cx "$d")
  [ "$n" -eq 1 ] || bad "$d has $n ADRs, needs exactly 1"
done
# with or without the spec: no decision has two records
twice=$(printf '%s' "$have" | sort | uniq -d | tr '\n' ' ')
[ -z "$twice" ] || bad "more than one ADR for: $twice"

for p in "$c" docs/adr/*.md; do
  [ -f "$p" ] || continue
  if grep -qE 'TODO|TBD|—' "$p"; then
    grep -nE 'TODO|TBD|—' "$p" | head -3
    bad "$p has a TODO, TBD or em dash"
  fi
done

[ "$fail" -eq 0 ] && echo "context and ADRs: ok"
exit "$fail"

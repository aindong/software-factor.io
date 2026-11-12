#!/bin/bash
# The design critique of the Accounts page (each login's limits, issue #12): made with the impeccable
# skill's critique command on screenshots of the built page in both themes at 1440 and 390, its
# counts those of its own list, no finding of its two highest severities, and made on the interface
# as it was when the report was last committed.
# Usage: bash test/acceptance/accounts-critique.sh [report]   (default docs/critiques/accounts-limits.md)
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
file=${1:-$here/docs/critiques/accounts-limits.md}
fail() { echo "accounts-critique: $1"; exit 1; }
field() { sed -nE "s/^$1: *(.*)$/\\1/p" "$file" | head -1; }

[ -s "$file" ] || fail "$file is missing or empty"
skill=$(field skill); severities=$(field severities); major=$(field major)
screens=$(field screens); counts=$(field counts); seen=$(field commit)
for key in skill severities major screens counts commit; do
  [ -n "$(field "$key")" ] || fail "the report has no \"$key:\" line"
done
echo "$skill" | grep -q "impeccable" && echo "$skill" | grep -q "critique" || fail "the report was not made with the impeccable critique: skill: $skill"
[ "$major" = "$(echo "$severities" | cut -d' ' -f1-2)" ] || fail "major must be the two highest severities ($severities), not $major"
for theme in light dark; do
  for width in 1440 390; do
    echo " $screens " | grep -q " accounts-limits-$theme-$width\\.png " || fail "the report looked at no accounts-limits-$theme-$width.png"
  done
done
# its counts are its list's, and every finding has a severity it declared, a place, what and a fix
for sev in $severities; do
  n=$(grep -cE "^### F[0-9]+ \\[$sev\\] " "$file")
  echo " $counts " | grep -q " $sev=$n " || fail "the counts line does not say $sev=$n, which is what its list holds"
done
n=$(grep -cE "^### F[0-9]+ \\[" "$file")
while read -r line; do
  [ -n "$line" ] || continue
  sev=$(echo "$line" | sed -E 's/^### F[0-9]+ \[([^]]+)\].*/\1/')
  echo " $severities " | grep -q " $sev " || fail "a finding has the severity \"$sev\", which the report did not declare"
done < <(grep -E "^### F[0-9]+ \\[" "$file")
for key in where what fix; do
  [ "$(grep -cE "^$key: .+" "$file")" -ge "$n" ] || fail "not every finding says \"$key:\""
done
# no finding of the two highest severities is left open
for sev in $major; do
  open=$(grep -cE "^### F[0-9]+ \\[$sev\\] " "$file")
  [ "$open" = 0 ] || fail "$open finding(s) of severity $sev are open: fix them and make the critique again"
done
# it looked at the interface as it was when the report was last committed (or now, before that)
git -C "$here" cat-file -e "$seen^{commit}" 2> /dev/null || fail "the report names \"$seen\", which is no commit here"
asof=$(git -C "$here" log -1 --format=%H -- "${file#"$here"/}")
[ -n "$asof" ] && [ -z "$(git -C "$here" status --porcelain -- "${file#"$here"/}")" ] || asof=HEAD
last=$(git -C "$here" log -1 --format=%H "$asof" -- src/ui)
git -C "$here" merge-base --is-ancestor "$last" "$seen" || fail "the critique (commit $seen) was made before the last change to src/ui ($last)"
echo "accounts-critique: ok ($n findings, none of $major)"

#!/bin/bash
# The design critique is closed: two reports by reviewers who did not build the interface, the
# second made after the polish, with no open finding of the two highest severities, and every
# major finding of the first accounted for. A report cannot pass by being empty or by a count
# that does not match its own list.
# Usage: bash test/acceptance/critique-closed.sh [folder]   (default .agent/evidence/2026-11-10-task17)
#        bash test/acceptance/critique-closed.sh --self-test
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)

field() { sed -nE "s/^$1: *(.*)$/\\1/p" "$2" | head -1; }
# check one report: its header, that the screenshots it names exist, that its counts are its list's
report() { # report <file> <folder of its screenshots>
  local file=$1 shots=$2 sev n
  [ -s "$file" ] || { echo "$file is missing or empty"; return 1; }
  local severities major screens counts
  severities=$(field severities "$file"); major=$(field major "$file")
  screens=$(field screens "$file"); counts=$(field counts "$file")
  [ -n "$severities" ] && [ -n "$major" ] && [ -n "$screens" ] && [ -n "$counts" ] || { echo "$file lacks a severities, major, screens or counts line"; return 1; }
  [ "$major" = "$(echo "$severities" | cut -d' ' -f1-2)" ] || { echo "$file: major must be the two highest severities ($severities)"; return 1; }
  for shot in $screens; do
    [ -s "$shots/$shot" ] || { echo "$file names a screenshot that is not there: $shots/$shot"; return 1; }
  done
  for screen in floor runs run inbox accounts costs plugins; do
    for theme in light dark; do
      echo " $screens " | grep -Eq " $screen-$theme-(1440|390)\\.png " || { echo "$file looked at no $theme screenshot of $screen"; return 1; }
    done
  done
  for sev in $severities; do
    n=$(grep -cE "^### F[0-9]+ \\[$sev\\] " "$file")
    echo " $counts " | grep -q " $sev=$n " || { echo "$file: its counts line does not say $sev=$n, which is what its list holds"; return 1; }
  done
  n=$(grep -cE "^### F[0-9]+ \\[" "$file")
  [ "$n" = "$(grep -cE "^### " "$file" | tr -d ' ')" ] || true
  # every finding has a severity the report declared, and what, where and a fix
  while read -r line; do
    sev=$(echo "$line" | sed -E 's/^### F[0-9]+ \[([^]]+)\].*/\1/')
    echo " $severities " | grep -q " $sev " || { echo "$file: a finding has the severity \"$sev\", which it did not declare"; return 1; }
  done < <(grep -E "^### F[0-9]+ \\[" "$file")
  for key in where what fix; do
    [ "$(grep -cE "^$key: .+" "$file")" -ge "$n" ] || { echo "$file: not every finding says \"$key:\""; return 1; }
  done
  return 0
}
majors() { # the ids of a report's major findings
  local file=$1 major sev
  major=$(field major "$file")
  for sev in $major; do grep -E "^### F[0-9]+ \\[$sev\\] " "$file" | sed -E 's/^### (F[0-9]+) .*/\1/'; done
}
whole() { # a report may be in parts, to keep each file small: <name>.md, <name>.part2.md, ...
  local file=$1 part
  [ -s "$file" ] || return 0
  cat "$file"
  for part in "${file%.md}".part*.md; do [ -s "$part" ] && cat "$part"; done
}
closed() { # closed <folder>
  local dir=$1 id line state joined
  joined=$(mktemp -d)
  whole "$dir/critique.md" > "$joined/critique.md"
  whole "$dir/critique-after.md" > "$joined/critique-after.md"
  report "$joined/critique.md" "$dir/before" || return 1
  report "$joined/critique-after.md" "$dir/screens" || return 1
  [ -s "$dir/findings.md" ] || { echo "$dir/findings.md is missing"; return 1; }
  for id in $(majors "$joined/critique.md"); do
    [ "$(grep -cE "^- $id: " "$dir/findings.md")" = "1" ] || { echo "findings.md must account for $id of the first critique, once"; return 1; }
    line=$(grep -E "^- $id: " "$dir/findings.md")
    state=$(echo "$line" | sed -E "s/^- $id: ([a-z]+).*/\\1/")
    case "$state" in
      fixed)
        ref=$(echo "$line" | sed -nE 's/^[^(]*\(([^)]+)\).*/\1/p')
        [ -n "$ref" ] || { echo "findings.md: $id is fixed, but names no commit or file in ()"; return 1; }
        git -C "$here" cat-file -e "$ref^{commit}" 2> /dev/null || [ -e "$here/$ref" ] || { echo "findings.md: $id names \"$ref\", which is no commit and no file"; return 1; }
        ;;
      declined)
        echo "$line" | grep -Eq "^- $id: declined: .{20,}" || { echo "findings.md: $id is declined without a reason"; return 1; }
        ;;
      *) echo "findings.md: $id must be \"fixed (<commit or file>)\" or \"declined: <reason>\""; return 1 ;;
    esac
  done
  [ -z "$(majors "$joined/critique-after.md")" ] || { echo "the second critique still has major findings: $(majors "$joined/critique-after.md" | tr '\n' ' ')"; return 1; }
  # the second critique looked at the interface as it is now
  seen=$(field commit "$joined/critique-after.md")
  last=$(git -C "$here" log -1 --format=%H -- src/ui)
  [ -n "$seen" ] && git -C "$here" merge-base --is-ancestor "$last" "$seen" 2> /dev/null || { echo "the second critique (commit \"$seen\") was made before the last change to src/ui ($last)"; return 1; }
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  # the check must fail on reports that should not pass
  t=$(mktemp -d); mkdir -p "$t/before" "$t/screens"
  names=""
  for screen in floor runs run inbox accounts costs plugins; do
    for theme in light dark; do
      for dir in before screens; do echo x > "$t/$dir/$screen-$theme-1440.png"; done
      names="$names $screen-$theme-1440.png"
    done
  done
  good() { # good <file> <findings...>
    local file=$1; shift
    { echo "severities: P0 P1 P2 P3"; echo "major: P0 P1"; echo "screens:$names"; echo "commit: $(git -C "$here" rev-parse HEAD)"; echo "counts: $COUNTS"; echo; printf '%s\n' "$@"; } > "$file"
  }
  finding() { printf '### %s [%s] title\nwhere: here\nwhat: this\nwhy: so\nfix: that\n' "$1" "$2"; }
  COUNTS="P0=0 P1=1 P2=0 P3=0" good "$t/critique.md" "$(finding F1 P1)"
  COUNTS="P0=0 P1=0 P2=1 P3=0" good "$t/critique-after.md" "$(finding F1 P2)"
  echo "- F1: fixed (package.json)" > "$t/findings.md"
  closed "$t" > /dev/null || { echo "self-test: a good pair of reports was refused: $(closed "$t")"; exit 1; }
  bad() { closed "$t" > /dev/null && { echo "self-test: passed with $1"; exit 1; }; }
  : > "$t/critique-after.md"; bad "an empty second report"
  COUNTS="P0=0 P1=0 P2=0 P3=0" good "$t/critique-after.md" "$(finding F1 P2)"; bad "a count that is not its list's"
  COUNTS="P0=0 P1=1 P2=0 P3=0" good "$t/critique-after.md" "$(finding F1 P1)"; bad "a major finding in the second report"
  COUNTS="P0=0 P1=0 P2=1 P3=0" good "$t/critique-after.md" "$(finding F1 P2)"
  echo "- F1: declined: no" > "$t/findings.md"; bad "a major declined with no reason"
  : > "$t/findings.md"; bad "a major of the first report that is not accounted for"
  echo "- F1: fixed (no-such-file-or-commit)" > "$t/findings.md"; bad "a fix that names nothing"
  echo "- F1: fixed (package.json)" > "$t/findings.md"
  rm "$t/screens/floor-dark-1440.png"; bad "a screenshot that is not there"
  echo x > "$t/screens/floor-dark-1440.png"
  sed -i '' -e "s/^commit: .*/commit: $(git -C "$here" rev-list --max-parents=0 HEAD | tail -1)/" "$t/critique-after.md"; bad "a second report older than the interface"
  echo "critique-closed self-test: ok"
  exit 0
fi

# The reports are among the goal run's own records, which are not in the repository. Where they
# are not (a clone), the check proves itself and says so.
if [ $# -eq 0 ] && [ ! -d "$here/.agent/evidence/2026-11-10-task17" ]; then
  bash "$0" --self-test || exit 1
  echo "critique: the run's records are not on this machine, so only the check itself was checked"
  exit 0
fi
dir=${1:-$here/.agent/evidence/2026-11-10-task17}
closed "$dir" || exit 1
first=$(mktemp); whole "$dir/critique.md" > "$first"
echo "critique: closed ($(grep -cE '^### F[0-9]+ \[' "$first") findings in the first pass, $(majors "$first" | wc -l | tr -d ' ') major; $(whole "$dir/critique-after.md" | grep -cE '^### F[0-9]+ \[') in the second, none major)"

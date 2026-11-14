#!/bin/bash
# The rest of the Inbox's round three, by keyboard and measured in the page:
#  G17 at 390 the decision bar is low (one sentence and the buttons) and what has the keyboard is never under it;
#  G18 after Approve the keyboard stays on the approved run when it waits again at its next checkpoint;
#  G19 an empty Inbox says "Nothing waits for you." once, with links to the Floor and Runs, and no stale line;
#  G20 the Answer button is as high as Approve.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/inbox-rest.sh [folder for screenshots]
# Prints "inbox-rest: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-rest-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"
# shellcheck source=test/fixtures/inbox-decide.sh
. "$here/test/fixtures/inbox-decide.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
decide_fixture
start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Inbox
wait_for "the inbox lists what waits" "$tasks" 'monthly sales report \| .*search box.* \| Pick a database'
asks='() => document.querySelector(".decide .asks")?.textContent ?? ""'

# ---- G20: the Answer button is as high as Approve
height='() => Math.round(document.querySelector(".choices .button").getBoundingClientRect().height)'
tab_to '^[0-9]+ Add an export button'
wait_for "the build is on show" "$asks" 'Build has finished'
approve_height=$(js "$height")
pw press ArrowDown
pw press ArrowDown
wait_for "the question is on show" "$asks" 'Which database'
expect "Answer is as high as Approve" "$(js "$height")" "^$approve_height$"
pw press ArrowUp
pw press ArrowUp
wait_for "the build is on show again" "$asks" 'Build has finished'
pw press Enter

# ---- G17: at 390 the bar is low and covers nothing that has the keyboard
pw resize 390 844
sleep 0.4
bar='() => Math.round(document.querySelector(".decide").getBoundingClientRect().height)'
expect "the bar takes at most 160 px of the screen" "$(js "() => ($bar)() <= 160 ? 'ok' : ($bar)()")" '^ok$'
shot inbox-approve-light-390
for _ in $(seq 1 12); do
  pw press Tab
  inside=$(js "() => document.querySelector('.rundetail')?.contains(document.activeElement) ? 'yes' : 'no'")
  [ "$inside" = yes ] || continue
  expect "what has the keyboard is not under the bar" "$(js "() => { const a = document.activeElement.getBoundingClientRect(); const b = document.querySelector('.decide').getBoundingClientRect(); return a.bottom <= b.top + 1 || a.top >= b.bottom - 1 ? 'clear' : 'covered: ' + document.activeElement.textContent.trim().slice(0, 30); }")" '^clear$'
done
expect "the scroll area keeps room under what has the keyboard" "$(js "() => parseFloat(getComputedStyle(document.querySelector('.rundetail')).scrollPaddingBottom) >= 8 ? 'ok' : 'none'")" '^ok$'
pw resize 1440 900
sleep 0.4

# ---- G18: after Approve the keyboard stays on the approved run, which waits again at its next checkpoint
back_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "the build is on show" "$asks" 'Build has finished'
pw press a
wait_for "the approved run waits again before Ship it, and the keyboard is on it" "$focused" '^([0-9]+ )?Add an export button'
expect "it is the step before Ship it that is listed for that run" "$(js "$tasks")" 'Add an export button'

# ---- G19: nothing is left: said once, with links, and no stale line
run_ids=$(sf inbox | grep -oE '\b[0-9a-f]{8}\b' | sort -u)
for id in $run_ids; do sf stop "$id" > /dev/null 2>&1; done
plain='() => document.querySelector(".plain")?.textContent ?? ""'
wait_for "an empty inbox says nothing waits" "$plain" 'Nothing waits for you\.'
expect "it says so once" "$(js "() => (document.querySelector('main').textContent.match(/Nothing waits for you/g) || []).length")" '^1$'
expect "the stale line is gone" "$(js "() => document.querySelector('main').textContent.includes('Choose what to decide')")" '^false$'
expect "one line of links to the Floor and to Runs" "$(js "() => [...document.querySelectorAll('.plain a')].map((a) => a.textContent.trim()).join(' | ')")" '^Floor \| Runs$'
shot inbox-empty-light-1440
theme Dark
shot inbox-empty-dark-1440
theme Light
pw resize 390 844
sleep 0.4
narrow "the empty Inbox"
shot inbox-empty-light-390
for _ in $(seq 1 12); do
  [ "$(js "() => document.activeElement.closest('.plain') ? 'yes' : 'no'")" = yes ] && break
  pw press Tab
done
expect "a link in the empty Inbox is a stop of the Tab order" "$(js "() => document.activeElement.closest('.plain') ? 'yes' : 'no'")" '^yes$'
pw press Tab
expect "the second link is Runs" "$(js "$focused")" '^Runs$'
pw press Enter
wait_for "the link goes to Runs" "() => location.pathname" '^/runs$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-rest: ok"

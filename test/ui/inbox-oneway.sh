#!/bin/bash
# An approval that cannot be taken back (a command lane that ships) must not look like a harmless one:
# the button is named after the act ("Approve and run ship", the key stays a), a quiet line under the
# buttons says "This cannot be undone.", and what starts next is said once, not twice. The decision bar's
# first sentence names the task it decides. Driven with key presses only, measured in the page.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/inbox-oneway.sh [folder for screenshots]
# Prints "inbox-oneway: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-oneway-$$"
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

buttons='() => [...document.querySelectorAll(".choices .button")].map((b) => b.textContent).join(" | ")'
asks='() => document.querySelector(".decide .asks")?.textContent ?? ""'

# ---- an approval after a lane: a harmless one, named plainly, and the bar names the task
tab_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "the build is on show" "$asks" 'Build has finished'
expect "the bar's first sentence names the task" "$(js "$asks")" '^Add an export button for the monthly sales report: Build has finished and waits for your approval\.'
expect "the button is only Approve" "$(js "$buttons")" '^Approve a \| Reject r \| Send back s$'
expect "nothing says it cannot be undone" "$(js "() => document.querySelector('.decide').innerText.includes('cannot be undone')")" '^false$'

# ---- an approval before a command lane: one that cannot be taken back
pw press a
wait_for "the step before Ship it is on show" "$asks" 'Ship it waits for your approval'
expect "the button is named after the act, the key stays" "$(js "$buttons")" '^Approve and run ship a \| Reject r$'
expect "the first sentence names the task here too" "$(js "$asks")" '^Add an export button for the monthly sales report: Ship it waits'
expect "what starts next is not said a second time" "$(js "() => document.querySelectorAll('.decide .next').length")" '^0$'
expect "a quiet line under the buttons says it cannot be undone" "$(js "() => { const l = document.querySelector('.decide .final'); const c = document.querySelector('.decide .choices'); const a = document.querySelector('.decide .asks'); const s = getComputedStyle(l); return [l.textContent, c.getBoundingClientRect().bottom <= l.getBoundingClientRect().top, Number(s.fontWeight) < Number(getComputedStyle(a).fontWeight), s.color !== getComputedStyle(a).color].join(' '); }")" '^This cannot be undone\. true true true$'
expect "the button fits at desk width" "$(js "() => { const b = document.querySelector('.choices .approve'); return b.scrollWidth <= b.clientWidth; }")" '^true$'
shot inbox-oneway-light-1440
theme Dark
shot inbox-oneway-dark-1440
theme Light
pw resize 390 844
sleep 0.4
expect "at 390 the line and the buttons are on the screen" "$(js "() => { const b = document.querySelector('.decide').getBoundingClientRect(); return b.bottom <= innerHeight && b.right <= innerWidth; }")" '^true$'
shot inbox-oneway-light-390
pw resize 1440 900
sleep 0.4

# ---- the key still approves, and the run goes on to Ship it
pw press a
wait_for "a approves and the item leaves" "$tasks" '^Add a search box to the order list \| Pick a database$|^Pick a database \| Add a search box to the order list$'

# ---- a question names its task too, and is not one-way
pw press ArrowDown
js "$focused" | grep -q "Pick a database" || pw press ArrowUp
pw press Enter
wait_for "the question is on show" "$asks" 'Which database'
expect "a question has no one-way line" "$(js "() => document.querySelectorAll('.decide .final').length")" '^0$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-oneway: ok"

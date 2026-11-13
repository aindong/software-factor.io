#!/bin/bash
# Reject and Send back say what they do before they are pressed: one quiet sentence under the buttons
# that names both (Send back only where the lane's work can be sent back), in the workflow's words
# (here the fail route stops the run). A question shows none; the line is never louder than what is
# asked; Approve has no undo, and says nothing of one. Driven with key presses only.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/inbox-consequence.sh [folder for screenshots]
# Prints "inbox-consequence: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-consequence-$$"
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

line='() => document.querySelector(".decide .consequence")?.innerText ?? "none"'
# where it is and how loud: under the buttons, no heavier and no larger than what is asked, softer in colour
quiet='() => {
  const c = document.querySelector(".decide .consequence"), a = document.querySelector(".decide .asks:not(.next)");
  const choices = document.querySelector(".decide .choices"), st = getComputedStyle(c), at = getComputedStyle(a);
  return JSON.stringify({
    under: choices.getBoundingClientRect().bottom <= c.getBoundingClientRect().top,
    lighter: Number(st.fontWeight) < Number(at.fontWeight),
    notLarger: parseFloat(st.fontSize) <= parseFloat(at.fontSize),
    softer: st.color !== at.color,
    inside: c.getBoundingClientRect().right <= innerWidth,
  });
}'

# an approval after a lane: both consequences
tab_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "the build is on show" "() => document.querySelector('.decide .asks')?.textContent ?? ''" '.'
expect "Reject and Send back say what they do, under the buttons" "$(js "$line")" '^Reject: the run stops\. Send back: Build runs again with your note\.$'
for width in 1440 390; do
  pw resize "$width" 844
  sleep 0.4
  expect "at $width the line is under the buttons" "$(js "$quiet")" '"under":true'
  expect "at $width it is lighter than what is asked" "$(js "$quiet")" '"lighter":true'
  expect "at $width it is no larger" "$(js "$quiet")" '"notLarger":true'
  expect "at $width it is softer in colour" "$(js "$quiet")" '"softer":true'
  expect "at $width it fits the screen" "$(js "$quiet")" '"inside":true'
  shot "inbox-after-light-$width"
done
expect "Approve has no undo to promise" "$(js "() => document.querySelector('.decide').innerText.toLowerCase().includes('undo')")" '^false$'
pw resize 1440 900
sleep 0.4

# an approval before a lane: nothing to send back
pw press a
wait_for "the page moves on to the next build" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" 'search box'
sleep 1
pw press a
wait_for "both builds wait before Ship it" "$tasks" '^Pick a database \| Add an export button .* \| Add a search box'
back_to '^[0-9]+ (Pick a database|Add an export button)'
js "$focused" | grep -q "export button" || pw press ArrowDown
pw press Enter
wait_for "the item before Ship it is on show" "() => document.querySelector('.decide .next')?.textContent ?? ''" '^Approve: Ship it starts next\.$'
expect "only Reject is explained before a lane has run" "$(js "$line")" '^Reject: the run stops\.$'

# a question: neither
back_to '^[0-9]+ Pick a database|^[0-9]+ Add an export button'
js "$focused" | grep -q "Pick a database" || pw press ArrowUp
pw press Enter
wait_for "the question is on show" "() => document.querySelector('.decide .asks')?.textContent ?? ''" 'Which database'
expect "a question explains no reject" "$(js "$line")" '^none$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-consequence: ok"

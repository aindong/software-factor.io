#!/bin/bash
# An approval before a command lane puts what the command will do ABOVE the buttons, in the weight of
# the sentence that says what is decided: the command's name in the code face and the run's branch on
# a line of its own; then Approve. Checked by where things are in the page, at 1440 and 390 wide.
# An approval after a lane and a question show no such lines. Driven with key presses only.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/inbox-ahead-first.sh [folder for screenshots]
# Prints "inbox-ahead-first: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-ahead-first-$$"
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

# a question and an approval after a lane say nothing of a command
ahead='() => document.querySelector(".decide .ahead")?.innerText ?? "none"'
tab_to '^[0-9]+ Add an export button'
pw press ArrowDown
pw press ArrowDown
expect "the keyboard is on the question's row" "$(js "$focused")" '^[0-9]+ Pick a database'
pw press Enter
wait_for "the question is on show" "() => document.querySelector('.decide .asks')?.textContent ?? ''" 'Which database'
expect "a question shows no command" "$(js "$ahead")" '^none$'
back_to '^[0-9]+ Pick a database'
pw press ArrowUp
pw press ArrowUp
pw press Enter
wait_for "the build is on show" "() => document.querySelector('.decide .asks')?.textContent ?? ''" '.'
expect "an approval after a lane shows no command" "$(js "$ahead")" '^none$'

# approve both builds: each then waits before Ship it
pw press a # the approved run waits again before Ship it, and the page stays on it
wait_for "the item before Ship it is on show" "() => document.querySelector('.decide .final')?.textContent ?? ''" '^This cannot be undone\.$'

# where things are: the sentence of what is decided, what the command does, the branch, then the buttons
parts='() => {
  const q = (s) => document.querySelector(s);
  const asks = q(".decide .asks:not(.next)"), what = q(".decide .ahead p:first-child"), branch = q(".decide .ahead p:last-child");
  const buttons = q(".decide .choices"), approve = q(".decide .button.approve");
  const w = (e) => getComputedStyle(e).fontWeight, s = (e) => getComputedStyle(e).fontSize;
  const code = q(".decide .ahead p:first-child code");
  return Object.entries({
    order: asks.getBoundingClientRect().top < what.getBoundingClientRect().top && what.getBoundingClientRect().bottom <= branch.getBoundingClientRect().top && branch.getBoundingClientRect().bottom <= approve.getBoundingClientRect().top,
    above: q(".decide .ahead").getBoundingClientRect().bottom <= buttons.getBoundingClientRect().top,
    sameWeight: w(what) === w(asks) && s(what) === s(asks),
    codeFace: code && code.textContent === "ship" && getComputedStyle(code).fontFamily !== getComputedStyle(asks).fontFamily,
    ownLine: branch !== what && !what.contains(branch) && (branch.querySelector("code")?.textContent ?? "").length > 3,
    approveOnScreen: approve.getBoundingClientRect().bottom <= innerHeight,
  }).map(([k, v]) => k + "=" + v).join(" ");
}'
for width in 1440 390; do
  pw resize "$width" 900
  sleep 0.4
  got=$(js "$parts")
  expect "at $width the sentence of what is decided, what the command does, the branch, then Approve, in that order" "$got" 'order=true'
  expect "at $width what the command does is above the buttons" "$got" 'above=true'
  expect "at $width what the command does has the weight and size of what is decided" "$got" 'sameWeight=true'
  expect "at $width the command's name is in the code face" "$got" 'codeFace=true'
  expect "at $width the branch is on a line of its own" "$got" 'ownLine=true'
  expect "at $width Approve is on the screen" "$got" 'approveOnScreen=true'
  shot "inbox-before-light-$width"
done
expect "the one key stays" "$(js "() => [...document.querySelectorAll('.choices .button')].map((b) => b.textContent).join(' | ')")" '^Approve and run ship a \| Reject r$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-ahead-first: ok"

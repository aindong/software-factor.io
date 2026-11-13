#!/bin/bash
# In an open inbox item the Tab order follows the order on the page, at 1440 and at 390 wide (where the
# decision sits under the proof, so its buttons come after the proof's controls), for each kind of item:
# an approval after a lane, an approval before a command lane and a question. No stop of the item is
# higher on the page than the one before it. Driven with key presses only.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/inbox-tab-order.sh
# Prints "inbox-tab-order: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="inbox-tab-order-$$"
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

# the stops of the open item (not the rail or the skip link), in Tab order: the first whose top is more than
# 12px above the one before it, or "none"
order='() => {
  const stops = [...document.querySelectorAll("main a[href], main button, main input, main select, main textarea, main [tabindex]")]
    .filter((e) => !e.disabled && e.tabIndex >= 0 && e.getClientRects().length > 0 && e.closest(".deciding"));
  const name = (e) => (e.getAttribute("aria-label") || e.textContent).replace(/\s+/g, " ").trim().slice(0, 24);
  for (let i = 1; i < stops.length; i += 1) {
    const here = stops[i].getBoundingClientRect(), was = stops[i - 1].getBoundingClientRect();
    if (here.top < was.top - 12 && here.left < was.right) return name(stops[i - 1]) + " then " + name(stops[i]);
  }
  return stops.length > 3 ? "none" : "too few stops: " + stops.length;
}'
in_order() { # in_order <what>: at both widths
  for width in 1440 390; do
    pw resize "$width" 844
    sleep 0.4
    expect "$1 at $width: the Tab order follows the page" "$(js "$order")" '^none$'
  done
  pw resize 1440 900
  sleep 0.4
}

tab_to '^[0-9]+ Add an export button'
pw press Enter
wait_for "the build is on show" "() => document.querySelector('.decide .asks')?.textContent ?? ''" '.'
in_order "an approval after a lane"

pw press a
wait_for "the page moves on to the next build" "() => document.querySelector('.rundetail h2')?.textContent ?? ''" 'search box'
sleep 1
pw press a
wait_for "both builds wait before Ship it" "$tasks" '^Pick a database \| Add an export button .* \| Add a search box'
back_to '^[0-9]+ (Pick a database|Add an export button)'
js "$focused" | grep -q "export button" || pw press ArrowDown
pw press Enter
wait_for "the item before Ship it is on show" "() => document.querySelector('.decide .next')?.textContent ?? ''" '^Approve: Ship it starts next\.$'
in_order "an approval before a command lane"

back_to '^[0-9]+ Pick a database|^[0-9]+ Add an export button'
js "$focused" | grep -q "Pick a database" || pw press ArrowUp
pw press Enter
wait_for "the question is on show" "() => document.querySelector('.decide .asks')?.textContent ?? ''" 'Which database'
in_order "a question"

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "inbox-tab-order: ok"

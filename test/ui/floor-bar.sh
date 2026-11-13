#!/bin/bash
# The Floor's top bar (issues #19 and #20), in a real browser, by keyboard: at desk width its first read is
# the workflow's name and what waits, with the editing controls (the three kinds of lane, Undo, Revert,
# Save) folded until they are needed; Save is a stop of the Tab order the moment there is something to
# save, and Ctrl or Cmd S saves too. The two count links are targets of 24 px at desk width and 44 px at
# phone width. Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-bar.sh [folder for screenshots]
# Prints "floor-bar: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-bar-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
status() { js "() => document.querySelector('.topbar .status').textContent"; }
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cp "$here/workflows/full-loop.json" .factor/workflows/
node -e 'const fs = require("fs"); const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "full-loop"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
elsewhere 1 1 # one run waits at a lane and one is stopped, in workflows other than the one on show

# the names of the controls of the top bar that are shown
bar="() => [...document.querySelectorAll('.topbar button, .topbar select, .topbar input')].filter((e) => e.getClientRects().length > 0).map((e) => (e.getAttribute('aria-label') || e.labels?.[0]?.textContent || e.textContent).trim()).join(' | ')"
links='() => [...document.querySelectorAll(".topbar .needs a")].map((a) => { const r = a.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); }).join(" ")'
# a link is at least this high, at the width the window has now
tall() { # tall <least height>
  expect "both count links are at least $1 px high" "$(js "() => { const h = [...document.querySelectorAll('.topbar .needs a')].map((a) => a.getBoundingClientRect().height); return h.length === 2 && h.every((x) => x >= $1 - 0.5) ? 'ok' : h.map(Math.round).join(' '); }")" '^ok$'
}

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^6$'
wait_for "the top bar says what waits" "() => document.querySelector('.topbar .needs')?.textContent ?? ''" '^1 waits for you · 1 stopped$'

# 1. nothing is changed yet: no Undo, Revert or Save, and the three kinds of lane are behind one button
expect "the top bar shows no editing buttons before a change" "$(js "$bar")" '^Workflow \| Diagram \| JSON \| Runs on map \| Add a lane$'
expect "the state is said all the same" "$(status)" '^Saved$'
expect "the three kinds of lane are not shown" "$(js "() => [...document.querySelectorAll('.topbar button')].some((b) => /^(Agent|Command|Wait)$/.test(b.textContent) && b.getClientRects().length > 0)")" '^false$'
shot floor-bar-light-1440
tall 24
expect "the links do not look bigger: their text is as high as a line of it" "$(js "() => { const a = document.querySelector('.topbar .needs a'); const line = parseFloat(getComputedStyle(a).lineHeight); const n = document.querySelector('.topbar .needs').getBoundingClientRect().height; return n <= line + 1 ? 'same' : 'the line grew to ' + n; }")" '^same$'

# 2. the button opens the kinds, by keyboard; adding a lane closes them again, and the editing buttons come
tab_to '^Add a lane$'
expect "the button says it is closed" "$(js "() => document.activeElement.getAttribute('aria-expanded')")" '^false$'
pw press Enter
expect "Enter opens it" "$(js "() => document.activeElement.getAttribute('aria-expanded')")" '^true$'
pw press Tab
expect "the next stop is the first kind of lane" "$(js "$focused")" '^Agent$'
pw press Tab
pw press Tab
pw press Enter
expect "Wait adds a lane" "$(js "() => document.querySelectorAll('.station.lane').length")" '^7$'
expect "Undo, Revert and Save are there now" "$(js "$bar")" '^Workflow \| Diagram \| JSON \| Runs on map \| Add a lane \| Undo \| Revert \| Save$'
expect "and the kinds are folded again" "$(js "() => document.querySelector('.addlane').dataset.open")" '^false$'
pw press Control+z
expect "Undo takes the lane back" "$(js "() => document.querySelectorAll('.station.lane').length")" '^6$'

# 3. a change that can be saved: Save is a stop of the Tab order, and the key saves
wait_for "the inspector holds the workflow's settings" "() => document.querySelector('.inspector h2')?.textContent ?? ''" '.'
tab_to '^What this workflow is for'
pw type " Also checked by keyboard."
expect "the change is not saved" "$(status)" '^Not saved$'
expect "Save is a stop of the Tab order, and on" "$(js "() => { const b = document.querySelector('.topbar .button.primary'); return b && !b.disabled && b.tabIndex >= 0 && b.getClientRects().length > 0 ? b.textContent : 'not reachable'; }")" '^Save$'
tab_to '^Save$'
pw press Enter
wait_for "the save is confirmed" "() => document.querySelector('.topbar .status').textContent" '^Saved'
grep -q "Also checked by keyboard" .factor/workflows/full-loop.json || fail "the file on disk does not hold the change"
in_window "the floor after a save"

# 4. at phone width the links are targets of 44 px, and the page does not scroll sideways
pw resize 390 844
wait_for "the top bar still says what waits" "() => document.querySelector('.topbar .needs')?.textContent ?? ''" '^1 waits for you · 1 stopped$'
tall 44
narrow "the Floor at phone width"
shot floor-bar-light-390

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor-bar: ok"

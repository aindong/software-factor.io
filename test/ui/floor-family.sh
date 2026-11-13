#!/bin/bash
# The Floor's eye and its controls (the owner's ask), in a real browser: what waits for a person is the
# one count in the top bar that is read first, and the controls of the bar (button, select, segmented
# switch, checkbox) are one family: the same height, the same edge, the same corner. The page is only read.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-family.sh [folder for screenshots]
# Prints "floor-family: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-family-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
for name in $(env | sed -nE 's/^(FACTOR_[A-Za-z0-9_]*)=.*/\1/p'); do unset "$name"; done
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cp "$here/workflows/full-loop.json" .factor/workflows/
node -e 'const fs = require("fs"); const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "full-loop"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
elsewhere 1 1 # one run waits and one is stopped, in workflows other than the one on show

# the top bar's controls as a family: each one's height, its border and its corner
family='() => [...document.querySelectorAll(".topbar button, .topbar select, .topbar fieldset.segmented, .topbar .check")].filter((e) => e.getClientRects().length > 0 && !e.closest("fieldset.segmented") || e.matches("fieldset.segmented")).map((e) => { const c = getComputedStyle(e); return (e.getAttribute("aria-label") || e.textContent).trim() + " " + e.getBoundingClientRect().height + "px " + c.borderTopWidth + " " + c.borderTopLeftRadius; }).join(" | ")'
# the count links: the one that says who waits is read first
weight='() => { const [wait, stopped] = [...document.querySelectorAll(".topbar .needs a")].map((a) => getComputedStyle(a)); return wait.fontWeight + "/" + stopped.fontWeight + " " + (wait.color !== stopped.color); }'

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^6$'
wait_for "the top bar says what waits" "() => document.querySelector('.topbar .needs')?.textContent ?? ''" '^1 waits for you · 1 stopped$'
expect "the top bar's button, select and segmented switch are one height, one edge and one corner" "$(js "() => { const got = new Set((${family})().split(' | ').filter((t) => !t.startsWith('Runs on map')).map((t) => t.split(' ').slice(-3).join(' '))); return got.size === 1 ? 'one family' : [...got].join(' / '); }")" '^one family$'
expect "the count of what waits for you is heavier and darker than the others" "$(js "$weight")" '^600/500 true$'
shot floor-family-light-1440
pw resize 390 844
wait_for "the top bar says what waits at phone width" "() => document.querySelector('.topbar .needs')?.textContent ?? ''" '^1 waits for you · 1 stopped$'
expect "also at phone width" "$(js "$weight")" '^600/500 true$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor-family: ok"

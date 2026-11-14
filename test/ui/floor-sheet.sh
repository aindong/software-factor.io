#!/bin/bash
# The Floor at phone width, round three (G4): an open lane or workflow sheet is a lower sheet that leaves the map
# and the queue's Run buttons in sight above it; Close and Escape put the keyboard back on what opened the
# sheet (the lane's station, or the button of the Tools fold); and in the top bar the counts do not
# overlap the Tools and Undo buttons. By keyboard, measuring boxes and document.activeElement.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-sheet.sh [folder for screenshots]
# Prints "floor-sheet: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor"
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
elsewhere 1 1 # one run waits and one is stopped, in workflows other than the one on show
node -e '
const fs = require("fs");
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name: "queue", description: "One command.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/queue.md" } }],
  lanes: [{ id: "ship", name: "Ship", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } }] };
fs.writeFileSync(".factor/workflows/queue.json", JSON.stringify(w, null, 2));
fs.writeFileSync(".factor/queue.md", "- [ ] First chore\n- [ ] Second chore\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "queue"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
git add -A && git commit -q -m "the queue workflow"
sf collect > /dev/null || fail "collect"

on_station='() => document.activeElement?.matches(".map .station") ? "station" : (document.activeElement?.textContent ?? "").trim() || "(nothing)"'
sheet='() => document.querySelector(".inspector").dataset.open'
# is everything of the page that matters in sight above the sheet: the map's foot, and every Run button
above='() => { const top = document.querySelector(".inspector").getBoundingClientRect().top; const lows = [document.querySelector(".map-scroll svg.map"), ...document.querySelectorAll(".queue button")].map((e) => e.getBoundingClientRect().bottom); const worst = Math.max(...lows); return worst <= top + 0.5 ? "clear" : "something reaches " + Math.round(worst - top) + " px under the sheet"; }'
to_station() { for _ in $(seq 1 40); do [ "$(js "$on_station")" = station ] && return 0; pw press Tab; done; fail "Tab never reached a station"; }

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 390 844
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^1$'
wait_for "the queue is drawn" "() => document.querySelectorAll('.queue li').length" '^2$'
shot floor-queued-closed-light-390

# 1. a lane opened by keyboard: a lower sheet, the map and the Run buttons above it
to_station
pw press Enter
expect "Enter opens the sheet" "$(js "$sheet")" '^true$'
expect "the sheet is about 40 percent of the floor, at most 45" "$(js "() => { const f = document.querySelector('.floor').getBoundingClientRect().height; const s = document.querySelector('.inspector').getBoundingClientRect().height; return s <= f * 0.45 + 1 ? 'low' : Math.round((100 * s) / f) + ' percent'; }")" '^low$'
expect "the map and every Run button are above the sheet" "$(js "$above")" '^clear$'
expect "the Run buttons are in the window" "$(js "() => [...document.querySelectorAll('.queue button')].every((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })")" '^true$'
expect "the sheet scrolls inside itself" "$(js "() => /auto|scroll/.test(getComputedStyle(document.querySelector('.inspector')).overflowY)")" '^true$'
shot floor-queued-light-390

# 2. Escape closes it and puts the keyboard back on the station
pw press Escape
expect "Escape closes the sheet" "$(js "$sheet")" '^false$'
expect "the keyboard is back on the station" "$(js "$on_station")" '^station$'

# 3. Close closes it the same way
pw press Enter
expect "Enter opens it again" "$(js "$sheet")" '^true$'
tab_to '^Close$'
pw press Enter
expect "Close closes the sheet" "$(js "$sheet")" '^false$'
expect "the keyboard is back on the station after Close" "$(js "$on_station")" '^station$'

# 4. the workflow's sheet, opened from the Tools fold: Escape and Close put the keyboard back on the button that opened it
pw reload
wait_for "the workflow is drawn again" "() => document.querySelectorAll('.station.lane').length" '^1$'
tab_to '^Tools$'
pw press Enter
tab_to '^Workflow settings$'
pw press Enter
expect "Workflow settings opens the sheet" "$(js "$sheet")" '^true$'
expect "the map and every Run button are above that sheet too" "$(js "$above")" '^clear$'
pw press Escape
expect "Escape closes the workflow's sheet" "$(js "$sheet")" '^false$'
expect "the keyboard is on the button that opened it, in the Tools fold" "$(js "$focused")" '^(Workflow settings|Tools)$'
pw press Enter
tab_to '^Close$'
pw press Enter
expect "Close closes the workflow's sheet" "$(js "$sheet")" '^false$'
expect "the keyboard is on the button that opened it, after Close" "$(js "$focused")" '^(Workflow settings|Tools)$'

# 5. with a change made (Undo is drawn) the counts overlap neither the Tools button nor Undo
tab_to '^Agent$'
pw press Enter
tab_to '^Close$'
pw press Enter
expect "Undo is drawn" "$(js "() => [...document.querySelectorAll('.topbar button')].some((b) => b.textContent.trim() === 'Undo' && b.getClientRects().length > 0)")" '^true$'
expect "the counts overlap no button of the top bar" "$(js "() => { const hit = (r, s) => Math.min(r.right, s.right) - Math.max(r.left, s.left) > 0.5 && Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 0.5; const bar = [...document.querySelectorAll('.topbar button, .topbar .status, .topbar select')].filter((e) => e.getClientRects().length > 0); const out = []; for (const a of document.querySelectorAll('.topbar .needs a')) for (const b of bar) if (hit(a.getBoundingClientRect(), b.getBoundingClientRect())) out.push(a.textContent + ' meets ' + (b.textContent.trim() || b.className)); return out.length ? out.join('; ') : 'apart'; }")" '^apart$'
expect "every count is still a target of 44 px" "$(js "() => [...document.querySelectorAll('.topbar .needs a')].every((a) => a.getBoundingClientRect().height >= 43.5)")" '^true$'
shot floor-topbar-light-390

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
kill "$server" 2> /dev/null
playwright-cli -s="$session" close > /dev/null 2>&1
echo "floor-sheet: ok"

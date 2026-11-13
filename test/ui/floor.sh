#!/bin/bash
# The factory floor in a real browser, by keyboard: the steps of the plan's browser check, kept so
# that they can be run again. Needs playwright-cli and a built command (pnpm run build). The page
# is driven with key presses and then read. The one exception is step 0, which presses the mouse
# on a station's handle, because the bug it guards was a pointer's.
# Usage: bash test/ui/floor.sh [folder for screenshots]
# Prints "floor: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
status() { js "() => document.querySelector('.topbar .status').textContent"; }
json() { js "() => document.querySelector('.json textarea').value.includes('$1')"; }
to_text() { # Tab until the keyboard is in the JSON text
  for _ in $(seq 1 40); do
    [ "$(js "() => document.activeElement.tagName")" = "TEXTAREA" ] && return 0
    pw press Tab
  done
  fail "Tab never reached the JSON text"
}
# a workspace with the default workflow
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cp "$here/workflows/full-loop.json" .factor/workflows/
node -e 'const fs = require("fs"); const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "full-loop"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
file=.factor/workflows/full-loop.json
elsewhere 2 1 # two runs wait at a lane and one is stopped, in workflows other than the one on show

start_ui 0
pw open "$address" || fail "the browser did not open"
grep -q "Console: [1-9]" "$work/pw.log" && fail "the page logged an error: $(cat "$work/pw.log")"
pw resize 1440 900
expect "the key is taken out of the address bar" "$(js '() => location.href')" '^http://127\.0\.0\.1:[0-9]+/$'
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^6$'
shot floor-light-1440
labels_apart "the floor, floor-light-1440"
names_belong "the floor, floor-light-1440"

# the top bar says whether anything needs the person, counted over every workflow and not only the one on show
needs='() => document.querySelector(".topbar .needs")?.textContent ?? "no line"'
wait_for "the top bar says what needs the person, across workflows" "$needs" '^2 wait for you · 1 stopped$'
expect "the two counts are links to the Inbox and to the stopped runs" "$(js "() => [...document.querySelectorAll('.topbar .needs a')].map((a) => a.getAttribute('href')).join(' ')")" '^/inbox /runs\?show=stopped$'
expect "the map is drawn up to the canvas, at most 1.5 times its natural size" "$(js "$map_fill")" '^fills$'
expect "the map is wider than 900 px and no wider than its canvas" "$(js "() => { const w = document.querySelector('.map-scroll svg.map').getBoundingClientRect().width; return w > 900 && w <= document.querySelector('.map-scroll').clientWidth ? 'ok' : Math.round(w) + ' px'; }")" '^ok$'
tab_to '^2 wait for you$'
pw press Enter
wait_for "the count of runs that wait leads to the Inbox" "() => document.querySelector('h1').textContent" '^Inbox$'
pw press g && pw press f
wait_for "g then f is back on the Floor" "() => document.querySelector('h1').textContent" '^Floor$'
tab_to '^1 stopped$'
pw press Enter
wait_for "the count of stopped runs leads to Runs" "() => document.querySelector('h1').textContent + ' ' + location.search" '^Runs \?show=stopped$'
expect "with the stopped filter on" "$(js "() => document.querySelector('.runfilter [aria-pressed=true]')?.textContent.trim() ?? 'no filter'")" '^Stopped'
pw press g && pw press f
wait_for "the Floor again" "() => document.querySelector('h1').textContent" '^Floor$'
# task badges: with the runs that wait shown on the map, each has a hit area of 24 by 24 at desk width
tab_to '^Workflow$'
pw type "gate"
wait_for "the workflow with two runs waiting shows two task badges" "() => document.querySelectorAll('g.train').length" '^2$'
expect "each task badge has a hit area of at least 24 by 24 px" "$(hits 'g.train .hit' 24 24)" '^ok$'
unpainted "the Floor at desk width"
centres_free "the Floor with two task badges"
pw reload # the keyboard starts from the top of the page again
wait_for "the workflow is drawn again" "() => document.querySelectorAll('.station.lane').length" '^6$'

# the purpose box shows the whole description, not four lines of it
expect "the workflow's purpose is shown whole" "$(js "() => { const t = document.querySelector('.inspector textarea'); return t.scrollHeight <= t.clientHeight + 1 ? 'whole' : 'cut at ' + t.clientHeight + ' of ' + t.scrollHeight; }")" '^whole$'

# 0. a press of the mouse on a station's handle, with no drag, changes nothing
at=$(js "() => { const b = document.querySelector('.station[aria-label^=\"Lane Build\"] .handle.pass').getBoundingClientRect(); return Math.round(b.x + b.width / 2) + ' ' + Math.round(b.y + b.height / 2); }")
# shellcheck disable=SC2086
pw mousemove $at && pw mousedown && pw mouseup
expect "a press with no drag leaves the workflow as it was" "$(status)" '^Saved$'
pw reload # the keyboard starts from the top of the page again
wait_for "the workflow is drawn again" "() => document.querySelectorAll('.station.lane').length" '^6$'

# 1. Tab into the map, arrows along it, Enter opens a station
tab_to '^Lane '
expect "Tab reaches the first station" "$(js "$focused")" '^Lane Plan, author, waits for a person$'
pw press ArrowRight && pw press ArrowRight
expect "the arrow keys move along the map" "$(js "$focused")" '^Lane Impact, author$'
pw press Enter
expect "Enter opens the station in the inspector" "$(js "$focused")" '^Lane Impact$'
in_window "the floor with a lane open"
shot lane-open-light-1440

# 2. add a lane after it, and connect its fail outcome back, with c
back_to '^Agent$'
pw press Enter
expect "a lane is placed after the selected one" "$(js "() => [...document.querySelectorAll('.station.lane')].map((s) => s.getAttribute('aria-label').replace('Lane ', '').split(',')[0]).join(' > ')")" 'Impact > lane > Review'
# the new lane has no instructions, and the floor does not write them: it is a problem until the author does
expect "a new agent lane is a problem until it says what to do" "$(status)" '^1 problem$'
tab_to '^Instructions$'
expect "the field is empty, with a hint and no value" "$(js "() => document.activeElement.value + '|' + document.activeElement.placeholder")" '^\|Say what this lane must do'
pw type "Say what the change could break."
expect "the workflow is not saved yet" "$(status)" '^Not saved$'
back_to '^Lane lane,'
pw press Control+z
expect "a run of typing in one field is one step of undo" "$(status)" '^1 problem$'
pw press Control+Shift+z
expect "and one step of redo" "$(status)" '^Not saved$'
pw press c
expect "c puts the keyboard on where the lane goes" "$(js "$focused")" '^When this lane passes, go to$'
pw press Tab
expect "the next control is the fail outcome" "$(js "$focused")" '^When this lane fails, go to$'
pw type "Imp"
expect "typing picks the lane to go back to" "$(js "() => document.activeElement.value")" '^impact$'
expect "a connection that goes back gets a round limit" "$(js "() => [...document.querySelectorAll('.inspector .note')].map((n) => n.textContent).join(' ')")" 'at most 2 times, then stops'
shot lane-added-and-connected
# undo takes the last change back, and redo brings it again
fails='() => document.querySelector("select[aria-label=\"When this lane fails, go to\"]").value'
pw press Control+z
expect "undo takes back the connection" "$(js "$fails")" '^@stop$'
pw press Control+Shift+z
expect "redo makes it again" "$(js "$fails")" '^impact$'

# to another section and back: the floor is as it was left, and the rail says it holds unsaved work
back_to '^Lane lane,' # a letter typed in a field is the field's
pw press g
expect "after g the rail shows each section's letter" "$(js "() => document.querySelector('.rail').className")" 'armed'
pw press r
wait_for "g then r goes to Runs" "() => document.querySelector('h1').textContent" '^Runs$'
expect "the rail says the floor is not saved" "$(js "() => document.querySelector('.rail .unsaved')?.getAttribute('aria-label') ?? 'no mark'")" 'not saved'
pw press g && pw press f
wait_for "the floor is as it was left" "() => document.querySelector('h1').textContent + ' ' + document.querySelectorAll('.station.lane').length + ' ' + document.querySelector('.topbar .status').textContent" '^Floor 7 Not saved$'

# 3. the same change is in the JSON view, and a lane typed there shows on the map
back_to '^JSON$'
pw press Enter
to_text
expect "the JSON view holds the new lane" "$(js "() => { const t = document.querySelector('.json textarea').value; return [t.includes('\"id\": \"lane\"'), t.includes('\"maxRounds\": 2')].join(' '); }")" '^true true$'
# to the end of the text, take out what closes the list of lanes, and type one more lane
pw press "$text_bottom"
for _ in 1 2 3 4 5 6 7; do pw press Backspace; done
pw type ', { "id": "docs", "name": "Docs", "uses": "core/command@1", "with": { "run": "true" }, "checkpoint": "out", "on": { "pass": "@done", "fail": "@stop" } } ] }'
expect "the lane was typed into the text" "$(json '"id": "docs"')" '^true$'
shot json-light-1440

# 4. a problem is listed with its place and its fix, and Save is off: nothing leads to the new lane yet
expect "the status counts the problem" "$(status)" '^1 problem$'
tab_to '^1 problem elsewhere in the workflow$'
pw press Enter
expect "the problem has its place and its fix" "$(js "() => document.querySelector('.problems li').innerText.replace(/\\n/g, ' | ')")" 'lanes\[7\] \| Nothing leads to lane .+docs.+ \| Point a transition at it, or remove it\.'
expect "Save is off while there is a problem" "$(js "() => String(document.querySelector('.button.primary').disabled)")" '^true$'
shot problem-with-its-fix
back_to '^Diagram$'
pw press Enter
expect "the map follows the JSON" "$(js "() => [...document.querySelectorAll('.station.lane .name')].map((n) => n.textContent).join(' > ')")" 'Impact > lane > Review > .* > Ship > Docs$'
# fixed on the map: Ship now passes to the new lane
tab_to '^Lane '
arrow_to '^Lane Ship,'
pw press c
pw type "Doc"
expect "typing picks the new lane" "$(js "() => document.activeElement.value")" '^docs$'
expect "the problem is gone" "$(status)" '^Not saved$'

# 5. a save the server refuses says why: the workflow's name, changed in the text, is not its file's
back_to '^JSON$'
pw press Enter
to_text
pw press "$text_top"
pw press ArrowDown && pw press ArrowDown && pw press ArrowDown
pw press "$line_end"
pw press Backspace && pw press Backspace
pw type 'x",'
expect "the name was changed in the text" "$(json '"name": "full-loopx",')" '^true$'
pw press Control+s
wait_for "a refused save says why" "() => document.querySelector('.topbar .status').textContent" '^Not saved: .*full-loopx'
pw press Backspace && pw press Backspace && pw press Backspace
pw type '",'
expect "the name is back" "$(json '"name": "full-loop",')" '^true$'

# 6. save by keyboard: the file is written, and the checker accepts it
pw press Control+s
wait_for "the save is confirmed" "() => document.querySelector('.topbar .status').textContent" '^Saved'
wait_for "the save says when it was, and of what file" "() => document.querySelector('.topbar .status').textContent + ' | ' + document.querySelector('.topbar .status').title" '^Saved (just now|[0-9]+ min ago) \| .*full-loop\.json$'
grep -q '"id": "docs"' "$file" || fail "the file on disk does not hold the lane typed in the JSON view"
grep -q '"id": "lane"' "$file" || fail "the file on disk does not hold the lane added on the map"
sf check > "$work/check.log" 2>&1 || fail "the saved workflow does not pass the checker: $(cat "$work/check.log")"

# 6b. the file is changed elsewhere. With nothing unsaved here, the floor follows it
rename() { node -e 'const fs = require("fs"); const [f, to] = process.argv.slice(1); const w = JSON.parse(fs.readFileSync(f)); w.lanes.find((l) => l.id === "lane").name = to; fs.writeFileSync(f, JSON.stringify(w, null, 2) + "\n");' "$file" "$1"; }
names='() => [...document.querySelectorAll(".station.lane .name")].map((n) => n.textContent).join(" > ")'
rename Elsewhere
back_to '^Diagram$'
pw press Enter
pw press g && pw press r
wait_for "g then r goes to Runs" "() => document.querySelector('h1').textContent" '^Runs$'
pw press g && pw press f
wait_for "the floor reads a file that was changed elsewhere" "$names" 'Impact > Elsewhere > Review'
expect "and holds nothing unsaved" "$(status)" '^Saved$'
# with a change made here too, Save does not write over the other: it says so and asks
tab_to '^Lane '
arrow_to '^Lane Docs,'
pw press Enter
tab_to '^Name$'
pw type "Handbook"
expect "a change is made here" "$(js "$names")" 'Handbook$'
rename Twice
pw press Control+s
wait_for "Save says the file was changed elsewhere" "() => document.querySelector('.topbar .status').textContent" "^Not saved: the workflow's file was changed since this copy of it was read\\."
grep -q '"name": "Twice"' "$file" || fail "the change made elsewhere was written over"
grep -q 'Handbook' "$file" && fail "the save went through over a file changed elsewhere"
expect "Save is off while the choice is open" "$(js "() => String(document.querySelector('.button.primary').disabled)")" '^true$'
shot save-over-a-changed-file
tab_to '^Save over it$'
pw press Enter
wait_for "saving over it is a choice, and it saves" "() => document.querySelector('.topbar .status').textContent" '^Saved'
grep -q 'Handbook' "$file" || fail "the file does not hold what was saved over it"
grep -q '"name": "Twice"' "$file" && fail "saving over the file left the other change in it"
tab_to '^JSON$'
pw press Enter

# 7. both themes, at desktop and at phone width
theme Dark
shot json-dark-1440
tab_to '^Diagram$'
pw press Enter
wait_for "the map is back" "() => document.querySelectorAll('.station.lane').length" '^8$'
shot floor-dark-1440
labels_apart "the floor, floor-dark-1440"
pw resize 390 844
expect "the map scrolls and does not reflow at phone width" "$(js "() => [document.documentElement.scrollWidth <= 390, document.querySelector('.map-scroll').scrollWidth > 390].join(' ')")" '^true true$'
tab_to '^Close$'
pw press Enter
expect "the sheet closes" "$(js "() => document.querySelector('.inspector').dataset.open")" '^false$'
# where the inspector is a sheet, one press of the mouse (or a tap) on a station opens it
# (a station that is in view and is not the one chosen)
at=$(js "() => { const s = [...document.querySelectorAll('.station.lane')].find((g) => { const b = g.querySelector('.body').getBoundingClientRect(); return b.left > 8 && b.right < innerWidth - 8 && g.getAttribute('aria-pressed') !== 'true'; }); const b = s.querySelector('.body').getBoundingClientRect(); return Math.round(b.x + b.width / 2) + ' ' + Math.round(b.y + b.height / 2) + ' ' + s.getAttribute('aria-label').split(',')[0]; }")
pressed=${at#* * }
# shellcheck disable=SC2086
pw mousemove ${at%% Lane*} && pw mousedown && pw mouseup
expect "a single press opens the lane" "$(js "() => document.querySelector('.inspector').dataset.open + ' ' + document.querySelector('.inspector h2').textContent")" "^true $pressed$"
tab_to '^Close$'
pw press Enter
# and the workflow's own settings have a way in, from the fold the floor's tools sit in at this width
back_to '^Tools$'
pw press Enter
tab_to '^Workflow settings$'
pw press Enter
expect "the workflow's settings open" "$(js "() => document.querySelector('.inspector').dataset.open + ' ' + document.activeElement.textContent")" '^true Workflow$'
tab_to '^Close$'
pw press Enter
back_to '^Tools$'
pw press Enter
fits "the floor"
walk "the floor"
shot floor-dark-390
labels_apart "the floor, floor-dark-390"
theme Light
shot floor-light-390
labels_apart "the floor, floor-light-390"
tab_to '^Lane '
arrow_to '^Lane Build'
pw press Enter
expect "a station opens as a sheet at phone width" "$(js "() => document.querySelector('.inspector').dataset.open")" '^true$'
fits "the open sheet"
walk "the open sheet"
shot sheet-light-390
theme Dark
shot sheet-dark-390
theme Light

# 8. a key the server no longer takes: the page says so, and the printed address in the same tab opens it
port=$(echo "$address" | sed -E 's|.*:([0-9]+)/.*|\1|')
kill "$server" && wait "$server" 2> /dev/null
start_ui "$port" # the same place, a new key
pw reload
wait_for "a key from before is said, not a blank page" "() => document.querySelector('h1')?.textContent ?? 'blank'" '^This tab has no key$'
pw goto "$address"
wait_for "the printed address opens the floor in the same tab" "() => [document.querySelector('h1')?.textContent, document.querySelectorAll('.station.lane').length > 0].join(' ')" '^Floor true$'

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
# the one refusal of step 5 and the key refused in step 8 are answers, not errors of the page
grep -E "^\[ERROR\]" "$work/console.log" | grep -vE "422|401" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor: ok"

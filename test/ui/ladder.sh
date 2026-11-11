#!/bin/bash
# The autonomy ladder at a lane, in a real browser, by keyboard: a lane that has earned a step,
# the step taken with its button, and a lane moved back after a defect got through. Needs
# playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/ladder.sh [folder for screenshots]
# Prints "ladder: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="ladder-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }
status() { js "() => document.querySelector('.topbar .status').textContent"; }
ladder='() => [...document.querySelectorAll(".inspector .ladder p")].map((p) => p.textContent).join(" | ")'
checkpoint='() => document.querySelector("select[aria-label=Checkpoint], .inspector label:has(select) select")?.value ?? ""'
edit() { node -e 'const fs = require("fs"); const [f, code] = process.argv.slice(1); const j = JSON.parse(fs.readFileSync(f)); new Function("j", code)(j); fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");' "$@"; }
last_run() { node -e 'const { DatabaseSync } = require("node:sqlite"); const r = new DatabaseSync(".factor/state.db", { readOnly: true }).prepare("select id, status from runs order by started_at desc, rowid desc limit 1").get(); console.log(r.id, r.status);'; }
clean_run() { # one run to the end, approved as it is wherever it waits
  sf run > /dev/null 2>&1
  for _ in 1 2 3; do
    set -- $(last_run)
    [ "$2" = waiting ] && sf approve "$1" > /dev/null 2>&1
  done
  set -- $(last_run)
  [ "$2" = done ] || fail "a run did not end done: $2"
  echo "$1"
}
open_lane() { # the keyboard to the map, along it to the lane, Enter opens it
  tab_to '^Lane '
  arrow_to "^Lane $1"
  pw press Enter
  wait_for "the lane is open" "() => document.querySelector('.inspector h2').textContent" "^Lane $1"
}

# ---- a workspace (the one-lane workflow) whose Work lane waits for a person, and a step up after two clean runs
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
one_lane
edit .factor/factory.json 'j.ladder = { runs: 2 }; j.commands.verify = "true"'
printf -- '- [ ] First\n- [ ] Second\n- [ ] Third\n- [ ] Fourth\n' > .factor/tasks.md
git add -A && git commit -q -m "a factory"
clean_run > /dev/null
clean_run > /dev/null

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^1$'

# 1. the lane's record, and the step it has earned
open_lane Work
wait_for "the inspector says where the lane stands and what it has earned" "$ladder" '^2 of 2 runs in a row approved as they were\. Its record has earned a step: it can move near the loop\.$'
expect "the lane is in the loop" "$(js "$checkpoint")" '^in$'
shot ladder-suggested-light-1440

# 2. with a change that is not saved, the step is not offered to press, and the page says why
tab_to '^Name$'
pw type "x"
expect "the floor holds a change" "$(status)" '^Not saved$'
expect "the button is off while the floor is not saved, and says why" "$(js "() => { const b = [...document.querySelectorAll('.ladder button')].find((x) => x.textContent === 'Move near the loop'); return b.disabled + ' ' + document.querySelector('.ladder').textContent.includes('Save or revert first'); }")" '^true true$'
back_to '^Lane '
pw press Control+z
expect "the change is taken back" "$(status)" '^Saved$'

# 3. the step is taken by keyboard: the file changes, and the page shows the lane where it now stands
pw press Enter
tab_to '^Move near the loop$'
pw press Enter
wait_for "the lane is near the loop, and the record says when it moved" "() => document.querySelector('.inspector .ladder')?.textContent ?? ''" 'Moved near the loop on [0-9]{4}-[0-9]{2}-[0-9]{2}\.'
wait_for "the checkpoint is the new one" "$checkpoint" '^near$'
grep -q '"checkpoint": "near"' .factor/workflows/starter.json || fail "the workflow's file does not hold the new checkpoint"
expect "the floor holds no change of its own" "$(status)" '^Saved$'
pw reload
wait_for "the workflow is drawn again" "() => document.querySelectorAll('.station.lane').length" '^1$'
open_lane Work
wait_for "after a reload the lane is still near the loop, with nothing earned yet" "$ladder" '^0 of 2 runs in a row with nothing found later\. \| Moved near the loop on'
expect "and no step is offered" "$(js "() => document.querySelectorAll('.ladder button').length")" '^0$'
# a save from the floor does not put the old step back
pw press Control+s
grep -q '"checkpoint": "near"' .factor/workflows/starter.json || fail "a save put the old checkpoint back"
shot ladder-moved-light-1440

# 4. a defect got through: reported from the command line, and shown at the lane
run=$(clean_run)
sf escape "$run" --lane work --note 'The export button was left out <b>of</b> the page' > "$work/escape.log" 2>&1 || fail "escape: $(cat "$work/escape.log")"
grep -q '"checkpoint": "in"' .factor/workflows/starter.json || fail "the escape did not move the lane back"
# the floor holds nothing unsaved: shown again, it reads the file that changed
pw press g && pw press r
wait_for "g then r goes to Runs" "() => document.querySelector('h1').textContent" '^Runs$'
pw press g && pw press f
wait_for "g then f goes to the Floor" "() => document.querySelector('h1').textContent" '^Floor$'
open_lane Work
wait_for "the lane is back in the loop, and the page says why, with the run and the note as text" "$ladder" "^0 of 2 runs in a row approved as they were\\. \\| Moved back in the loop on [0-9-]{10}, after a defect got through in run $run: The export button was left out <b>of</b> the page$"
expect "the note is text, not markup" "$(js "() => document.querySelectorAll('.ladder b').length")" '^0$'
expect "the checkpoint is in the loop again" "$(js "$checkpoint")" '^in$'
in_window "the floor with the ladder open"
shot ladder-moved-back-light-1440
theme Dark
open_lane Work
shot ladder-moved-back-dark-1440
theme Light

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -Eq "^\[ERROR\]" "$work/console.log" && fail "the page logged an error: $(cat "$work/console.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "ladder: ok"

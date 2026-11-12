#!/bin/bash
# The floor at phone width (issue #8): the view, "Runs on map" and "Add a lane" fold behind one
# button, and the map begins within 160 px of the top of the section. Every control is still
# reached with the keyboard: the button that folds them opens with Enter, and Tab then visits each.
# At desk width nothing is folded. Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-phone.sh [folder for screenshots]
# Prints "floor-phone: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-phone-$$"
server=""
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
# the variables of an outer factory run (this check run as a lane's) must not reach the throwaway workspace
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

# how far below the top of the floor's section the map begins, in whole pixels
gap='() => { const m = document.querySelector(".map-scroll"); if (!m || m.getClientRects().length === 0) return "no map"; return Math.round(m.getBoundingClientRect().top - m.closest(".work").getBoundingClientRect().top); }'
room() { # room <when>: the map begins within 160 px, and has the rest of the window
  local at
  at=$(js "$gap")
  [[ "$at" =~ ^[0-9]+$ ]] && [ "$at" -le 160 ] || fail "$1: the map begins $at px below the top of the floor, wanted at most 160"
}
# the button that folds the controls: the one in the top bar that says whether it is open
fold='document.querySelector(".topbar button[aria-expanded]")'
shown='(e) => !!e && e.getClientRects().length > 0'
# the names of the controls the Tab key can reach now (as keys.sh names the focused one)
names="() => ${tabbable}.map((a) => (a.getAttribute('aria-label') || a.labels?.[0]?.textContent || a.textContent || a.tagName).replace(/\\s+/g, ' ').trim()).join(' | ')"
reach() { # reach <when> <name>...: each is a stop of the Tab order
  local when=$1 all
  shift
  all=" | $(js "$names") | "
  for name in "$@"; do
    echo "$all" | grep -qF " | $name | " || fail "$when: \"$name\" is not a stop of the Tab order (the stops: $all)"
  done
}
to_fold() { # Tab or Shift+Tab until the keyboard is on the button that folds the controls
  for _ in $(seq 1 80); do
    [ "$(js "() => document.activeElement === ${fold}")" = "true" ] && return 0
    pw press "$1"
  done
  fail "the keyboard never reached a button in the top bar that folds the controls (one with aria-expanded)"
}

start_ui 0
pw open "$address" || fail "the browser did not open"

# 1. at desk width nothing is folded: the controls are in the top bar, and no button folds them
pw resize 1440 900
wait_for "the workflow is drawn" "() => document.querySelectorAll('.station.lane').length" '^6$'
expect "no button folds the controls at desk width" "$(js "() => (${shown})(${fold})")" '^false$'
reach "at desk width" Diagram JSON "Runs on map" Agent Command Wait

# 2. at phone width the map begins within 160 px of the top, with the controls folded
pw resize 390 844
pw reload # the keyboard starts from the top of the page again
wait_for "the workflow is drawn at phone width" "() => document.querySelectorAll('.station.lane').length" '^6$'
expect "the floor is saved" "$(status)" '^Saved$'
room "at phone width"
expect "the folded controls are not stops of the Tab order while folded" "$(js "() => ${tabbable}.some((e) => e.closest('.topbar') && /^(Agent|Command|Wait)$/.test(e.textContent.trim()))")" '^false$'
narrow "the floor with its controls folded"
shot floor-phone-folded

# 3. the button that folds them is reached by Tab, says it is closed, and opens with Enter
to_fold Tab
expect "the button says it is closed" "$(js "() => ${fold}.getAttribute('aria-expanded')")" '^false$'
pw press Enter
expect "Enter opens it" "$(js "() => ${fold}.getAttribute('aria-expanded')")" '^true$'
reach "with the controls open" "Workflow settings" Diagram JSON "Runs on map" Agent Command Wait
fits "the floor with its controls open"
walk "the floor with its controls open"
shot floor-phone-open

# 4. a change by keyboard: Undo, Revert and Save are reached too, and the map still begins within 160 px
to_fold Shift+Tab
tab_to '^Agent$'
pw press Enter
expect "a lane is added" "$(js "() => document.querySelectorAll('.station.lane').length")" '^7$'
tab_to '^Instructions$'
pw type "Say what the change could break."
expect "the change is not saved" "$(status)" '^Not saved$'
tab_to '^Close$'
pw press Enter
expect "the sheet closes" "$(js "() => document.querySelector('.inspector').dataset.open")" '^false$'
to_fold Shift+Tab
[ "$(js "() => ${fold}.getAttribute('aria-expanded')")" = "true" ] && pw press Enter
expect "the controls fold again with Enter" "$(js "() => ${fold}.getAttribute('aria-expanded')")" '^false$'
room "with a change not saved"
reach "with a change not saved" Undo Revert Save
walk "the floor with a change not saved"
shot floor-phone-changed

playwright-cli -s="$session" console error > "$work/console.log" 2>&1
grep -E "^\[ERROR\]" "$work/console.log" > "$work/errors.log"
[ -s "$work/errors.log" ] && fail "the page logged an error: $(cat "$work/errors.log")"
playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor-phone: ok"

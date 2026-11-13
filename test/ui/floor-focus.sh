#!/bin/bash
# Where the keyboard is after the Floor's two most repeated actions (round two, F1): after Save, and after Run on
# a queued task, it does not fall to the page. After Save it stays on "Add a lane" (at desk width); after Run it
# goes to the next queued task's Run button, and when none is left to the strip's heading or, if the strip is
# gone, to the map. Driven by keys only; the page's focus is never set by script.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-focus.sh [folder for screenshots]
# Prints "floor-focus: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-focus-$$"
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
node -e '
const fs = require("fs");
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name: "queue", description: "One command.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/queue.md" } }],
  lanes: [{ id: "ship", name: "Ship", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } }] };
fs.writeFileSync(".factor/workflows/queue.json", JSON.stringify(w, null, 2));
fs.writeFileSync(".factor/queue.md", "- [ ] First chore\n- [ ] Second chore\n- [ ] Third chore\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "queue"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
git add -A && git commit -q -m "the queue workflow"
sf collect > /dev/null || fail "collect"

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the strip lists the queue" "() => document.querySelectorAll('.queue li').length" '^3$'

# Save by keyboard: a change in the lane's own field, then Save
tab_to '^Lane Ship'
pw press Enter
tab_to '^Or a shell command'
pw type " && true"
expect "a change is pending" "$(js "() => document.querySelector('.topbar .status').textContent")" '^Not saved$'
tab_to '^Save$'
pw press Enter
wait_for "the change is saved" "() => document.querySelector('.topbar .status').textContent" '^Saved'
expect "after Save the keyboard is not on the page" "$(js "$focused")" '^Add a lane$'

# Run by keyboard: the keyboard goes to the next task's Run button
tab_to '^Run First chore$'
pw press Enter
wait_for "the first task has left the queue" "() => document.querySelectorAll('.queue li.queued').length" '^2$'
expect "after Run the keyboard is on the next task's Run button" "$(js "$focused")" '^Run Second chore$'
pw press Enter
wait_for "the second task has left the queue" "() => document.querySelectorAll('.queue li.queued').length" '^1$'
expect "and on the next again" "$(js "$focused")" '^Run Third chore$'
pw press Enter
wait_for "no task is queued" "() => document.querySelectorAll('.queue li.queued').length" '^0$'
expect "with none left the keyboard is on the strip's heading, or the map when the strip is gone" "$(js "$focused")" '^(Working now and queued|Lane Ship.*)$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "floor-focus: ok"

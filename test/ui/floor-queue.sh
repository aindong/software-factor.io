#!/bin/bash
# What is queued, on the Floor (issue #16), in a real browser, by keyboard: the line of counts says how
# many tasks are queued, a stopped run's task put back in the queue is counted at once, a quiet strip
# below the map lists them, and the Run button on a row starts that task as `softwarefactor run --task`
# does: the task leaves the queue and the run, which waits at its checkpoint, is counted as waiting.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/floor-queue.sh [folder for screenshots]
# Prints "floor-queue: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="floor-queue-$$"
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
# the workflow on show: one command lane that waits for approval, and two tasks to take
node -e '
const fs = require("fs");
const w = { $schema: "https://softwarefactor.io/schema/workflow/v1.json", version: 1, name: "queue", description: "One command.", roles: {}, limits: { minutes: 10, tokens: 1000 }, collectors: [{ id: "tasks", uses: "core/file@1", with: { path: ".factor/queue.md" } }],
  lanes: [{ id: "ship", name: "Ship", uses: "core/command@1", with: { run: "true" }, checkpoint: "in", on: { pass: "@done", fail: "@stop" } }] };
fs.writeFileSync(".factor/workflows/queue.json", JSON.stringify(w, null, 2));
fs.writeFileSync(".factor/queue.md", "- [ ] First chore\n- [ ] Second chore\n");
const f = JSON.parse(fs.readFileSync(".factor/factory.json")); f.workflow = "queue"; fs.writeFileSync(".factor/factory.json", JSON.stringify(f, null, 2));'
git add -A && git commit -q -m "the queue workflow"
sf collect > /dev/null || fail "collect"
broke=$(sf status | awk '$2 == "stopped" && $1 ~ /^[0-9a-f]{8}$/ { print $1; exit }')
[ -n "$broke" ] || fail "no stopped run to put back: $(sf status)"

needs='() => document.querySelector(".topbar .needs")?.textContent ?? "no line"'
rows='() => [...document.querySelectorAll(".queue li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()).join(" | ")'
start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
wait_for "the line of counts says what is queued" "$needs" '^1 waits for you · 1 stopped · 2 queued$'
expect "the strip below the map lists the queued tasks" "$(js "$rows")" '^First chore.*queued.*Run \| Second chore.*queued.*Run$'
shot floor-queue-light-1440
in_window "the Floor with a queue"
expect "a title and its button stay within one glance: the list is at most 560 px wide" "$(js "() => document.querySelector('.queue ul').getBoundingClientRect().width <= 560")" '^true$'

# a stopped run's task put back in the queue is counted, and listed, without a reload
sf requeue "$broke" > /dev/null || fail "requeue"
wait_for "the task put back is counted" "$needs" '^1 waits for you · 1 stopped · 3 queued$'
expect "and listed" "$(js "() => document.querySelectorAll('.queue li').length")" '^3$'

# the strip is below the map, and quieter than the line that says who waits: no yellow, no filled button
expect "the strip is below the map" "$(js "() => document.querySelector('.queue').getBoundingClientRect().top >= document.querySelector('.map-scroll svg.map').getBoundingClientRect().bottom - 1")" '^true$'
expect "the Run buttons are quiet ones, not the primary one" "$(js "() => [...document.querySelectorAll('.queue button')].filter((b) => b.classList.contains('primary')).length")" '^0$'

# the key: Run on a row starts that task
tab_to '^Run First chore$'
pw press Enter
wait_for "the task has left the queue and its run waits for the person" "$needs" '^2 wait for you · 1 stopped · 2 queued$'
expect "the strip lists what is left" "$(js "$rows")" '^Task 1 stopping.*Run \| Second chore.*Run$'
expect "a button is still reachable for the next task" "$(js "() => document.querySelectorAll('.queue button').length")" '^2$'
expect "the Run button's words are the command line's" "$(js "() => document.querySelector('.queue button').getAttribute('title')")" '^softwarefactor run --task '

# at phone width the strip stays within the page
pw resize 390 844
wait_for "the strip is drawn at phone width" "() => document.querySelectorAll('.queue li').length" '^2$'
fits "the Floor with a queue"
expect "each Run button is at least 44 px high at phone width" "$(js "() => [...document.querySelectorAll('.queue button')].every((b) => b.getBoundingClientRect().height >= 43.5)")" '^true$'
shot floor-queue-light-390

kill "$server" 2> /dev/null
playwright-cli -s="$session" close > /dev/null 2>&1
echo "floor-queue: ok"

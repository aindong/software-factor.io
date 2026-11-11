#!/bin/bash
# A run that is working must be easy to tell from one that waits, stopped or is done, in a real
# browser, by keyboard: its row says Working with a mark of its own, its lane on the map is
# ringed and the line it came along runs, the rail tells from any section; a run that waits does
# not move; and when the work ends nothing on the page is animated. The page is only read.
# Needs playwright-cli and a built command (pnpm run build).
# Usage: bash test/ui/running.sh [folder for screenshots]
# Prints "running: ok" and exits 0, or says which step failed and exits 1.
set -u
here=$(cd "$(dirname "$0")/../.." && pwd)
shots=${1:-}
work=$(mktemp -d)
session="running-$$"
server=""
slow=""
cleanup='[ -n "$slow" ] && kill "$slow" 2> /dev/null'
# shellcheck source=test/ui/keys.sh
. "$here/test/ui/keys.sh"

[ -f "$here/dist/cli.js" ] && [ -f "$here/dist/ui/index.html" ] || fail "build first: pnpm run build"
export FACTOR_HOME="$work/home"
sf() { node "$here/dist/cli.js" "$@"; }

# ---- a workspace: build, then review, then ship on approval; the reviewer's script is set before each run
mkdir -p "$work/demo-shop" && cd "$work/demo-shop" || fail "no work folder"
git init -q -b main && git config user.email t@example.com && git config user.name T
echo "# demo" > README.md && git add -A && git commit -q -m initial
sf init > /dev/null || fail "init"
cat > .factor/workflows/delivery.json << 'FLOW'
{
  "$schema": "https://softwarefactor.io/schema/workflow/v1.json",
  "version": 1,
  "name": "delivery",
  "description": "Build, review and ship on approval.",
  "roles": { "author": { "description": "Writes." }, "reviewer": { "description": "Reads." } },
  "limits": { "minutes": 60, "tokens": 1000000 },
  "commands": { "verify": { "description": "The tests." } },
  "collectors": [{ "id": "tasks", "uses": "core/file@1", "with": { "path": ".factor/tasks.md" } }],
  "gates": { "verify": { "uses": "core/command@1", "with": { "command": "verify" }, "onFail": "fail" } },
  "lanes": [
    { "id": "build", "name": "Build", "uses": "core/agent@1", "agent": { "role": "author", "access": "write", "prompt": "Build it." }, "gates": ["verify"], "checkpoint": "out", "on": { "pass": "review", "fail": "@stop" } },
    { "id": "review", "name": "Review", "uses": "core/agent@1", "agent": { "role": "reviewer", "access": "read", "prompt": "Review it." }, "checkpoint": "out", "on": { "pass": "ship", "fail": "@stop" } },
    { "id": "ship", "name": "Ship it", "uses": "core/command@1", "with": { "run": "true" }, "checkpoint": "in", "on": { "pass": "@done", "fail": "@stop" } }
  ]
}
FLOW
rm -f .factor/workflows/starter.json
node -e '
const fs = require("fs");
const f = JSON.parse(fs.readFileSync(".factor/factory.json"));
fs.writeFileSync(".factor/factory.json", JSON.stringify({ ...f, workflow: "delivery", commands: { verify: "true" } }, null, 2));
fs.writeFileSync(".factor/tasks.md", "- [ ] Add an export button\n- [ ] Fix the date format\n- [ ] Show the cost of each lane\n");
'
script() { # script <milliseconds the reviewer works>
  node -e '
const [ms] = process.argv.slice(1);
const roles = {
  author: { adapter: "fake", script: { build: [{ write: { path: "src/a.ts", content: "export {};\n" } }, { commit: "Add a" }, { handoff: { outcome: "pass", summary: "Built." } }] } },
  reviewer: { adapter: "fake", script: { review: [...(Number(ms) ? [{ sleep: Number(ms) }] : []), { handoff: { outcome: "pass", summary: "Read it." } }] } },
};
require("fs").writeFileSync(".factor/local.json", JSON.stringify({ roles }, null, 2));
' "$1"
  git add -A && git commit -q -m "set up the factory" > /dev/null 2>&1
}

# ---- one run done, one that waits for approval, then one that works
script 0
sf run > "$work/run1.log" 2>&1; [ $? -eq 3 ] || fail "the first run should wait for approval: $(cat "$work/run1.log")"
first=$(sf runs 2> /dev/null | awk 'NR == 1 { print $1 }')
[ -n "$first" ] || fail "no run id in: $(sf runs 2>&1)"
sf approve "$first" > "$work/approve.log" 2>&1 || fail "approve: $(cat "$work/approve.log")"
sf run > "$work/run2.log" 2>&1; [ $? -eq 3 ] || fail "the second run should wait for approval: $(cat "$work/run2.log")"
script 120000 # long enough for a busy machine: the steps below must all happen while it works
sf run > "$work/run3.log" 2>&1 &
slow=$!

start_ui 0
pw open "$address" || fail "the browser did not open"
pw resize 1440 900
section Runs
rows='() => [...document.querySelectorAll(".run .mark")].map((m) => m.getAttribute("aria-label")).join(" | ")'
wait_for "the list shows the run that works beside the one that waits and the one that is done" "$rows" '^Working \| Waits for you \| Done$'

# ---- 1. the list and the head of the page
expect "the row says Working in words" "$(js "() => document.querySelector('.run .now')?.textContent ?? 'no word'")" '^Working$'
expect "only that row has the word and the mark of work" "$(js "() => document.querySelectorAll('.run .now').length + ' ' + document.querySelectorAll('.run .mark.working').length")" '^1 1$'
expect "the top bar counts it" "$(js "() => document.querySelector('.topbar .where span').textContent")" 'working'
expect "its mark pulses" "$(js "() => getComputedStyle(document.querySelector('.run .mark.working'), '::after').animationName")" '^at-work-ring$'
expect "the strip's train is the one that works" "$(js "() => document.querySelectorAll('.run .strip .train.working').length + ' ' + getComputedStyle(document.querySelector('.run .strip .train.working')).animationName")" '^1 at-work-train$'
expect "the head of the page says Working" "$(js "() => document.querySelector('.rundetail .state')?.textContent ?? 'none'")" '^Working$'
expect "the rail tells from here that one works" "$(js "() => document.querySelector('.rail .mark.live')?.getAttribute('aria-label') ?? 'none'")" '^1 working$'

# ---- 2. the map: the lane that works is ringed and breathes, the line it came along runs
pulse='() => document.querySelector(".rundetail .map .station.working .pulse") ? getComputedStyle(document.querySelector(".rundetail .map .station.working .pulse")).animationName : "no ring"'
wait_for "the lane that works has a ring that breathes" "$pulse" '^at-work-halo$'
expect "it is the review lane, and its name says the task works there" "$(js "() => document.querySelector('.rundetail .map .station.working').getAttribute('aria-label')")" '^Lane Review.*task [0-9]+ is here and working'
expect "the line the task came along runs" "$(js "() => document.querySelectorAll('.rundetail .map .flow').length + ' ' + getComputedStyle(document.querySelector('.rundetail .map .flow')).animationName")" '^1 at-work-flow$'
# an animation cannot be seen in one reading: read its clock twice
t0=$(js "() => Math.round(document.querySelector('.rundetail .map .flow').getAnimations()[0].currentTime)")
sleep 1
t1=$(js "() => Math.round(document.querySelector('.rundetail .map .flow').getAnimations()[0].currentTime)")
[ "$t1" -gt "$t0" ] 2> /dev/null || fail "the line does not run: its clock read $t0 then $t1"
expect "the train there is not yellow" "$(js "() => document.querySelectorAll('.rundetail .map .train.asks').length")" '^0$'
[ -n "$shots" ] && pw screenshot --filename="$shots/running-light-1440.png"

# ---- 3. the run that waits for a person does not move
tab_to '^[0-9]+ Show the cost of each lane'
pw press ArrowDown
wait_for "the run beside the list follows" "() => document.querySelector('.rundetail h2').textContent" '^Fix the date format$'
expect "its head says it waits" "$(js "() => document.querySelector('.rundetail .state').textContent")" '^Waits for you$'
expect "its train is yellow" "$(js "() => document.querySelectorAll('.rundetail .map .train.asks').length")" '^1$'
expect "nothing on its map moves" "$(js "() => document.querySelector('.rundetail .map').getAnimations({ subtree: true }).length + ' ' + document.querySelectorAll('.rundetail .map .flow, .rundetail .map .pulse').length")" '^0 0$'
[ -n "$shots" ] && pw screenshot --filename="$shots/running-waits-light-1440.png"
pw press ArrowDown
wait_for "the run that is done" "() => document.querySelector('.rundetail h2').textContent" '^Add an export button$'
expect "nothing on a done run's map moves" "$(js "() => document.querySelector('.rundetail .map').getAnimations({ subtree: true }).length")" '^0$'

# ---- 4. the rail tells from another section
section Inbox
wait_for "the inbox is open" "() => document.querySelector('h1').textContent" '^Inbox'
expect "the rail still tells that one works" "$(js "() => document.querySelector('.rail .mark.live')?.getAttribute('aria-label') ?? 'none'")" '^1 working$'

# ---- 5. when the work ends, nothing on the page moves
wait "$slow" 2> /dev/null
slow=""
section Runs
wait_for "the run that worked now waits for you" "$rows" '^Waits for you \| Waits for you \| Done$'
wait_for "nothing on the page is animated" "() => document.getAnimations().length + ' ' + document.querySelectorAll('.mark.working').length + ' ' + document.querySelectorAll('.map .flow, .map .pulse').length" '^0 0 0$'
expect "the rail no longer says it" "$(js "() => document.querySelector('.rail .mark.live') ? 'still' : 'gone'")" '^gone$'

playwright-cli -s="$session" close > /dev/null 2>&1
kill "$server" 2> /dev/null
echo "running: ok"
